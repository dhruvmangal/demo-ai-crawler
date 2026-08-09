-- PostgreSQL Database Initialization Script

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- crawl_jobs
CREATE TABLE IF NOT EXISTS crawl_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    target_url TEXT NOT NULL,
    status VARCHAR(50) NOT NULL, -- PENDING, RUNNING, AWAITING_CREDENTIALS, ENRICHING, COMPLETED, FAILED
    login_url TEXT, -- set when status = AWAITING_CREDENTIALS: the page that needs login
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- crawl_credentials: transient holding table for user-submitted login credentials.
-- A row exists only between "user submits via POST /api/crawl/:id/credentials" and
-- "worker picks up the job again" -- the worker deletes the row as soon as it reads it.
CREATE TABLE IF NOT EXISTS crawl_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    crawl_job_id UUID NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- pages
CREATE TABLE IF NOT EXISTS pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    parent_page_id UUID REFERENCES pages(id) ON DELETE SET NULL,
    via_label TEXT,
    via_selector TEXT,
    breadcrumb TEXT,
    dom_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_project_page_url UNIQUE (project_id, url)
);

-- page_snapshots
CREATE TABLE IF NOT EXISTS page_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    dom_hash TEXT NOT NULL,
    dom_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ui_elements
CREATE TABLE IF NOT EXISTS ui_elements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- button, form, table, dialog, input
    label TEXT,
    selector TEXT NOT NULL,
    role TEXT,
    confidence DOUBLE PRECISION DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- entities
CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    entity_type VARCHAR(255),
    confidence DOUBLE PRECISION DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_project_entity_name UNIQUE (project_id, name)
);

-- actions
CREATE TABLE IF NOT EXISTS actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    action_type VARCHAR(100) NOT NULL, -- Create, Edit, Approve, Reject, Refund, etc.
    selector TEXT,
    confidence DOUBLE PRECISION DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- relationships
CREATE TABLE IF NOT EXISTS relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relationship_type VARCHAR(100) NOT NULL, -- HAS_ORDER, HAS_INVOICE, etc.
    confidence DOUBLE PRECISION DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_source_target_rel UNIQUE (source_entity_id, target_entity_id, relationship_type)
);

-- workflows
CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    confidence DOUBLE PRECISION DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- workflow_steps
CREATE TABLE IF NOT EXISTS workflow_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    page_id UUID REFERENCES pages(id) ON DELETE SET NULL,
    action_id UUID REFERENCES actions(id) ON DELETE SET NULL,
    entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- summaries
CREATE TABLE IF NOT EXISTS knowledge_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL UNIQUE,
    domain VARCHAR(255),
    summary_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- AI-generated (LLM) descriptions, populated by the crawl-worker after each page is
-- discovered. Nullable/idempotent additions -- safe to re-run against an existing DB.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS ai_description TEXT;
ALTER TABLE ui_elements ADD COLUMN IF NOT EXISTS ai_description TEXT;

-- workflow_runs: job queue for the Playwright recording agent. Given a workflow,
-- workflow-agent-worker replays its steps in a fresh headless browser, records video,
-- and generates WebVTT captions from the AI summaries/descriptions already collected
-- during the crawl. video_path/captions_path are relative to the recordings volume,
-- served by crawler-app under /recordings/*.
CREATE TABLE IF NOT EXISTS workflow_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL, -- PENDING, RUNNING, COMPLETED, FAILED
    video_path TEXT,
    captions_path TEXT,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- workflow_scripts: one persisted, reusable Playwright script per workflow, produced by
-- the planner/generator agent pipeline (src/agent/script-planner.ts, script-generator.ts)
-- and repaired in place by the healer (src/agent/script-healer.ts) when a step's selector
-- goes stale. step_metadata is the executable artifact -- an array of
-- {stepNumber, narration, code, skipped, knowledgeContext}, where `code` is the body of an
-- `async (page, ctx) => {...}` function compiled at run time via node:vm. source_code is a
-- human-readable rendering of step_metadata for debugging/export; it is never parsed or
-- executed. status flips to NEEDS_REGENERATION when a heal-and-retry still fails, so the
-- next run regenerates from scratch instead of retrying the same broken script.
CREATE TABLE IF NOT EXISTS workflow_scripts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL UNIQUE REFERENCES workflows(id) ON DELETE CASCADE,
    source_code TEXT NOT NULL,
    step_metadata JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, NEEDS_REGENERATION
    version INTEGER NOT NULL DEFAULT 1,
    model VARCHAR(100) NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
    last_run_status VARCHAR(50), -- SUCCEEDED, FAILED
    heal_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workflow_scripts_workflow_id ON workflow_scripts(workflow_id);

-- workflow_script_heals: append-only audit trail, one row per heal attempt (successful or
-- not), so a persisted script's degradation/repair history over time is inspectable.
CREATE TABLE IF NOT EXISTS workflow_script_heals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_script_id UUID NOT NULL REFERENCES workflow_scripts(id) ON DELETE CASCADE,
    workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
    failed_step_number INTEGER,
    error_message TEXT,
    outcome VARCHAR(50) NOT NULL, -- HEALED, HEAL_FAILED
    diff_summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workflow_script_heals_script_id ON workflow_script_heals(workflow_script_id);

-- users: stores user profiles authenticated via Google OAuth, GitHub OAuth, or local demo.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    provider VARCHAR(50) NOT NULL, -- google, github, demo
    provider_user_id VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'user', -- user, admin
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- user_auth_logs: audit trail tracking every authentication event (signup, login, logout, refresh).
CREATE TABLE IF NOT EXISTS user_auth_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- SIGNUP, LOGIN, LOGOUT, TOKEN_REFRESH
    provider VARCHAR(50) NOT NULL, -- google, github, demo
    ip_address VARCHAR(100),
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performant user queries and auth event metrics
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider);
CREATE INDEX IF NOT EXISTS idx_auth_logs_user_id ON user_auth_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_logs_created_at ON user_auth_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_logs_event_type ON user_auth_logs(event_type);

