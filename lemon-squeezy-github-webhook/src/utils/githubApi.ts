/**
 * GitHub API utilities using Octokit
 * Handles GitHub API interactions for issues, PRs, and repository updates
 */

import { Octokit } from "@octokit/rest";
import type {
  GitHubCreateIssueParams,
  GitHubCreatePullRequestParams,
  GitHubUpdateRepositoryParams,
} from "../types";

/**
 * Initialize Octokit client
 *
 * @param token - GitHub personal access token
 * @returns Octokit instance
 */
export function initializeGitHub(token: string): Octokit {
  return new Octokit({
    auth: token,
  });
}

/**
 * Create an issue in a GitHub repository
 *
 * @param client - Octokit client
 * @param params - Issue parameters
 * @returns Created issue
 */
export async function createIssue(
  client: Octokit,
  params: GitHubCreateIssueParams
): Promise<any> {
  try {
    const response = await client.issues.create({
      owner: params.owner,
      repo: params.repo,
      title: params.title,
      body: params.body,
      labels: params.labels,
    });

    console.info(`Created issue #${response.data.number}`);
    return response.data;
  } catch (error) {
    console.error("Failed to create issue:", error);
    throw error;
  }
}

/**
 * Create a pull request in a GitHub repository
 *
 * @param client - Octokit client
 * @param params - Pull request parameters
 * @returns Created pull request
 */
export async function createPullRequest(
  client: Octokit,
  params: GitHubCreatePullRequestParams
): Promise<any> {
  try {
    const response = await client.pulls.create({
      owner: params.owner,
      repo: params.repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
      draft: params.draft || false,
    });

    console.info(`Created pull request #${response.data.number}`);
    return response.data;
  } catch (error) {
    console.error("Failed to create pull request:", error);
    throw error;
  }
}

/**
 * Update repository information
 *
 * @param client - Octokit client
 * @param params - Repository update parameters
 * @returns Updated repository
 */
export async function updateRepository(
  client: Octokit,
  params: GitHubUpdateRepositoryParams
): Promise<any> {
  try {
    const response = await client.repos.update({
      owner: params.owner,
      repo: params.repo,
      description: params.description,
      homepage: params.homepage,
      topics: params.topics,
    });

    console.info("Updated repository");
    return response.data;
  } catch (error) {
    console.error("Failed to update repository:", error);
    throw error;
  }
}

/**
 * Get repository information
 *
 * @param client - Octokit client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns Repository data
 */
export async function getRepository(
  client: Octokit,
  owner: string,
  repo: string
): Promise<any> {
  try {
    const response = await client.repos.get({
      owner,
      repo,
    });

    return response.data;
  } catch (error) {
    console.error("Failed to get repository:", error);
    throw error;
  }
}

/**
 * Create a release in a GitHub repository
 *
 * @param client - Octokit client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param tagName - Tag name for the release
 * @param name - Release name
 * @param body - Release notes
 * @param draft - Is this a draft release?
 * @returns Created release
 */
export async function createRelease(
  client: Octokit,
  owner: string,
  repo: string,
  tagName: string,
  name: string,
  body: string,
  draft: boolean = false
): Promise<any> {
  try {
    const response = await client.repos.createRelease({
      owner,
      repo,
      tag_name: tagName,
      name,
      body,
      draft,
    });

    console.info(`Created release: ${response.data.tag_name}`);
    return response.data;
  } catch (error) {
    console.error("Failed to create release:", error);
    throw error;
  }
}

/**
 * Add labels to an issue or pull request
 *
 * @param client - Octokit client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param issueNumber - Issue or PR number
 * @param labels - Array of label names
 * @returns Updated issue/PR
 */
export async function addLabels(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<any> {
  try {
    const response = await client.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels,
    });

    console.info(`Added labels to issue #${issueNumber}`);
    return response.data;
  } catch (error) {
    console.error("Failed to add labels:", error);
    throw error;
  }
}
