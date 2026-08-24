import { Page, Locator } from 'playwright';

/**
 * Heuristic login-wall detection and credential-field/submit-control discovery, extracted
 * out of PlaywrightCrawler so the detection strategy can grow (new signals, new frameworks)
 * without bloating the crawl loop.
 *
 * Detection is a *scored* combination of independent signals rather than a single hard check
 * (the old `input[type="password"]` test), because many custom login widgets -- React/MUI
 * style masked inputs, CSS `-webkit-text-security` masking, unlabeled web components -- never
 * use a native password input at all. A native `type="password"` field alone still always
 * clears the threshold, so existing detection behavior is a strict superset of the old one.
 */

export interface LoginDetectionResult {
  isLoginScreen: boolean;
  // True when the page only offers OAuth/SSO buttons ("Continue with Google", etc.) and has
  // no fillable username/password fields at all -- credentials can never satisfy this wall.
  ssoOnly: boolean;
  score: number;
  signals: string[];
}

export interface CredentialFieldSelectors {
  usernameSelector: string | null;
  passwordSelector: string | null;
}

export interface SubmitTarget {
  kind: 'button' | 'form-submit' | 'enter-key';
  formSelector?: string;
  buttonSelector?: string;
}

interface RawAnalysis {
  isLoginScreen: boolean;
  ssoOnly: boolean;
  score: number;
  signals: string[];
  usernameSelector: string | null;
  passwordSelector: string | null;
  submit: SubmitTarget;
}

export class LoginDetector {
  /** Is this page (in its current state) a login wall? */
  public static async detect(page: Page): Promise<LoginDetectionResult> {
    const raw = await this.runAnalysis(page, null);
    return { isLoginScreen: raw.isLoginScreen, ssoOnly: raw.ssoOnly, score: raw.score, signals: raw.signals };
  }

  /** Best-guess selectors for the username and password fields on the current page. */
  public static async findCredentialFields(page: Page): Promise<CredentialFieldSelectors> {
    const raw = await this.runAnalysis(page, null);
    return { usernameSelector: raw.usernameSelector, passwordSelector: raw.passwordSelector };
  }

  /**
   * Where to submit the login/signup form from. Scoped to the <form> (or nearest
   * login-shaped container, for JS-only forms with no real <form> tag) that owns
   * `anchorSelector` -- or the auto-detected password/username field if omitted -- so a
   * second, unrelated form on the same page (e.g. a newsletter signup) never gets targeted.
   */
  public static async findSubmitTarget(page: Page, anchorSelector: string | null = null): Promise<SubmitTarget> {
    const raw = await this.runAnalysis(page, anchorSelector);
    return raw.submit;
  }

  /** Executes a SubmitTarget: click the scoped button, else native form submit, else Enter. */
  public static async submit(page: Page, target: SubmitTarget, fallbackField: Locator): Promise<void> {
    if (target.kind === 'button' && target.buttonSelector) {
      const btn = page.locator(target.buttonSelector).first();
      if ((await btn.count()) > 0) {
        await btn.click();
        return;
      }
    }
    if (target.kind === 'form-submit' && target.formSelector) {
      const form = page.locator(target.formSelector).first();
      if ((await form.count()) > 0) {
        await form.evaluate((f: any) => (typeof f.requestSubmit === 'function' ? f.requestSubmit() : f.submit()));
        return;
      }
    }
    await fallbackField.press('Enter');
  }

  private static async runAnalysis(page: Page, anchorSelector: string | null): Promise<RawAnalysis> {
    return page.evaluate<RawAnalysis, string | null>((anchorSel) => {
      const signals: string[] = [];
      let score = 0;

      const isVisible = (el: Element): boolean => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return !(rect.width === 0 && rect.height === 0);
      };

      const getSelector = (el: Element): string => {
        if (el.id) return `#${el.id}`;
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-target');
        if (testId) return `[data-testid="${testId}"]`;
        const name = el.getAttribute('name');
        let selector = el.tagName.toLowerCase();
        if (name) selector += `[name="${name}"]`;
        if (el.className) {
          const classes = el.className.toString().split(/\s+/).filter(c => c && !c.includes('{') && !c.includes(':'));
          if (classes.length > 0) selector += `.${classes.slice(0, 3).join('.')}`;
        }
        return selector;
      };

      // Text-like inputs: everything that isn't an obviously non-credential control type.
      // Deliberately broad (rather than an allowlist of 'text'/'email'/'') so unlabeled or
      // framework-specific `type` values still get scored.
      const EXCLUDED_TYPES = new Set(['checkbox', 'radio', 'submit', 'button', 'hidden', 'file', 'image', 'reset', 'range', 'color', 'date', 'number']);
      const textLikeInputs = Array.from(document.querySelectorAll('input')).filter(el => {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        return !EXCLUDED_TYPES.has(type);
      }).filter(isVisible);

      interface Candidate { el: Element; score: number; reasons: string[]; selector: string; }
      const passwordCandidates: Candidate[] = [];
      const usernameCandidates: Candidate[] = [];

      textLikeInputs.forEach(el => {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
        const combined = [
          el.getAttribute('name'), el.id, el.getAttribute('placeholder'),
          el.getAttribute('aria-label'), el.getAttribute('data-testid')
        ].filter(Boolean).join(' ').toLowerCase();
        const style = window.getComputedStyle(el);
        const textSecurity = style.getPropertyValue('-webkit-text-security') || style.getPropertyValue('text-security');
        const isMasked = !!textSecurity && textSecurity !== 'none';

        // Password scoring: native type (strongest), autocomplete hint, CSS masking (how
        // most custom-styled password fields fake the dot masking without type="password"),
        // keyword match, and an adjacent show/hide-password toggle icon/button.
        let pwScore = 0;
        const pwReasons: string[] = [];
        if (type === 'password') { pwScore += 5; pwReasons.push('type=password'); }
        if (autocomplete === 'current-password' || autocomplete === 'new-password') { pwScore += 4; pwReasons.push(`autocomplete=${autocomplete}`); }
        if (isMasked) { pwScore += 4; pwReasons.push('css-text-security-masked'); }
        if (/pass(word)?|pwd|secret/.test(combined)) { pwScore += 2; pwReasons.push('keyword-match'); }
        const container = el.closest('div, label, span') || el.parentElement;
        if (container && container.querySelector('[class*="toggle" i][class*="pass" i], [class*="eye" i], [aria-label*="show password" i], [aria-label*="toggle password" i], [aria-label*="password visibility" i]')) {
          pwScore += 2; pwReasons.push('adjacent-visibility-toggle');
        }
        if (pwScore > 0) passwordCandidates.push({ el, score: pwScore, reasons: pwReasons, selector: getSelector(el) });

        let unScore = 0;
        const unReasons: string[] = [];
        if (autocomplete === 'username' || autocomplete === 'email') { unScore += 4; unReasons.push(`autocomplete=${autocomplete}`); }
        if (type === 'email') { unScore += 3; unReasons.push('type=email'); }
        if (/user(name)?|e-?mail|login|identifier/.test(combined)) { unScore += 2; unReasons.push('keyword-match'); }
        if (unScore > 0) usernameCandidates.push({ el, score: unScore, reasons: unReasons, selector: getSelector(el) });
      });

      passwordCandidates.sort((a, b) => b.score - a.score);
      usernameCandidates.sort((a, b) => b.score - a.score);

      const passwordBest = passwordCandidates[0] || null;
      let usernameBest = usernameCandidates.find(c => c.el !== passwordBest?.el) || null;

      // Positional fallback: a completely unlabeled custom field (no keyword/autocomplete
      // match at all) -- if there's exactly one other visible text-like field in the same
      // form as the password field, it's almost certainly the identifier field.
      if (passwordBest && !usernameBest) {
        const scope = passwordBest.el.closest('form') || passwordBest.el.parentElement?.closest('div') || null;
        if (scope) {
          const others = Array.from(scope.querySelectorAll('input')).filter(el => {
            if (el === passwordBest.el) return false;
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            return isVisible(el) && ['text', 'email', 'tel', ''].includes(type);
          });
          if (others.length === 1) {
            usernameBest = { el: others[0], score: 0, reasons: ['positional-fallback'], selector: getSelector(others[0]) };
          }
        }
      }

      if (passwordBest) {
        score += passwordBest.score;
        signals.push(...passwordBest.reasons.map(r => `password:${r}`));
      }

      const forgotLink = Array.from(document.querySelectorAll('a, button')).some(el => /forgot\s+(your\s+)?password|reset\s+(your\s+)?password/i.test(el.textContent || ''));
      if (forgotLink) { score += 2; signals.push('forgot-password-link'); }

      const headingText = (document.title + ' ' + Array.from(document.querySelectorAll('h1, h2')).map(h => h.textContent || '').join(' ')).toLowerCase();
      if (/log[\s-]?in|sign[\s-]?in|welcome back/.test(headingText)) { score += 1; signals.push('login-heading-or-title'); }

      if (/login|signin|sign-in|\bauth\b/i.test(location.pathname + location.hostname)) { score += 1; signals.push('login-url'); }

      const ssoButtons = Array.from(document.querySelectorAll('a, button')).filter(el => /continue with|sign in with|log in with/i.test(el.textContent || ''));
      const ssoOnly = ssoButtons.length > 0 && !passwordBest;
      if (ssoButtons.length > 0) { score += ssoOnly ? 3 : 1; signals.push('sso-button'); }

      // Submit target: scoped to the form/container that owns the anchor field (explicit
      // anchorSel if given, else whichever field detection landed on) so an unrelated second
      // form on the same page is never targeted. Prefers a button whose text/type reads as a
      // submit action; falls back to the form's native submit; falls back to Enter on the
      // caller's field locator.
      let submit: SubmitTarget = { kind: 'enter-key' };
      const anchorEl = anchorSel ? document.querySelector(anchorSel) : (passwordBest?.el || usernameBest?.el || null);
      if (anchorEl) {
        const isSubmitLike = (el: Element): boolean => {
          const text = (el.textContent || (el as HTMLInputElement).value || '').trim();
          return el.getAttribute('type') === 'submit' || /^(log[\s-]?in|sign[\s-]?in|continue|submit|next)$/i.test(text);
        };
        const form = anchorEl.closest('form');
        const scope = form || anchorEl.closest('[class*="login" i], [class*="signin" i], [class*="auth" i]') || anchorEl.parentElement?.parentElement || document.body;
        const btn = Array.from(scope.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')).find(isSubmitLike);
        if (btn) {
          submit = { kind: 'button', buttonSelector: getSelector(btn), formSelector: form ? getSelector(form) : undefined };
        } else if (form) {
          submit = { kind: 'form-submit', formSelector: getSelector(form) };
        }
      }

      // A native password field alone (score 5) always clears this on its own -- matches the
      // old `input[type="password"]`-only behavior as a strict subset of the new signals.
      return {
        isLoginScreen: score >= 3,
        ssoOnly,
        score,
        signals,
        usernameSelector: usernameBest?.selector || null,
        passwordSelector: passwordBest?.selector || null,
        submit
      };
    }, anchorSelector);
  }
}
