/**
 * Type definitions for Lemon Squeezy webhooks and GitHub API
 */

export interface WebhookConfig {
  secret: string;
  port: number;
  gitHubToken: string;
  gitHubRepo: string;
}

export interface LemonSqueezyWebhookEvent {
  id: string;
  type: string;
  data: {
    object: string;
    attributes: Record<string, any>;
  };
}

export interface WebhookVerificationResult {
  valid: boolean;
  timestamp?: number;
  error?: string;
}

export interface GitHubCreateIssueParams {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
}

export interface GitHubCreatePullRequestParams {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
}

export interface GitHubUpdateRepositoryParams {
  owner: string;
  repo: string;
  description?: string;
  homepage?: string;
  topics?: string[];
}

export interface WebhookPayload {
  meta: {
    event_name: string;
    custom_data?: Record<string, any>;
  };
  data: {
    id: string;
    type: string;
    attributes: Record<string, any>;
    relationships?: Record<string, any>;
  };
}
