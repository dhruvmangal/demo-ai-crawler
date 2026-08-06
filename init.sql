-- PostgreSQL Database Initialization Script

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- crawl_jobs
CREATE TABLE IF NOT EXISTS crawl_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    target_url TEXT NOT NULL,
    status VARCHAR(50) NOT NULL, -- PENDING, RUNNING, AWAITING_CREDENTIALS, COMPLETED, FAILED
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
