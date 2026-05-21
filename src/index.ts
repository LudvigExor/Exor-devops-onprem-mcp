import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createTwoFilesPatch } from "diff";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

type ServerConfig = {
  baseUrl: string;
  apiVersion: string;
  commentsApiVersion: string;
  defaultProject?: string;
  authHeader?: string;
  authMode: "header" | "pat" | "basic" | "windows" | "anonymous";
  useDefaultCredentials: boolean;
};

type LocalConfigServerEntry = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  automaticCodeReviewPR?: boolean;
  automaticCodeReviewPRCommand?: string;
};

type LocalPluginSettingsEntry = {
  automaticCodeReviewPR?: boolean;
  automaticCodeReviewPRCommand?: string;
};

type LocalConfigFile = {
  servers?: Record<string, LocalConfigServerEntry>;
  mcpServers?: Record<string, LocalConfigServerEntry>;
  pluginSettings?: Record<string, LocalPluginSettingsEntry>;
  plugins?: Record<string, LocalPluginSettingsEntry>;
};

type LocalAutomationSettings = {
  automaticCodeReviewPR: boolean;
  automaticCodeReviewPRCommand?: string;
  serverName?: string;
  configFilePath?: string;
  env: Record<string, string>;
};

type QueryValue = string | number | boolean | undefined;
type QueryParams = Record<string, QueryValue>;

type CollectionListResponse<T> = {
  count?: number;
  value?: T[];
};

type ProjectResponse = {
  id: string;
  name: string;
  description?: string;
  state?: string;
  visibility?: string;
  lastUpdateTime?: string;
};

type RepositoryResponse = {
  id: string;
  name: string;
  defaultBranch?: string;
  size?: number;
  remoteUrl?: string;
  webUrl?: string;
};

type PullRequestResponse = {
  pullRequestId: number;
  title: string;
  description?: string;
  status?: string;
  isDraft?: boolean;
  mergeStatus?: string;
  creationDate?: string;
  closedDate?: string;
  sourceRefName?: string;
  targetRefName?: string;
  repository?: {
    id?: string;
    name?: string;
    url?: string;
  };
  lastMergeSourceCommit?: {
    commitId?: string;
    url?: string;
  };
  lastMergeTargetCommit?: {
    commitId?: string;
    url?: string;
  };
  lastMergeCommit?: {
    commitId?: string;
    url?: string;
  };
  createdBy?: {
    displayName?: string;
    uniqueName?: string;
  };
  reviewers?: Array<{
    displayName?: string;
    vote?: number;
  }>;
  url?: string;
};

type GitUserDateResponse = {
  name?: string;
  email?: string;
  date?: string;
};

type PullRequestCommitResponse = {
  commitId?: string;
  comment?: string;
  author?: GitUserDateResponse;
  committer?: GitUserDateResponse;
  parents?: string[];
  remoteUrl?: string;
  url?: string;
  changeCounts?: Record<string, number>;
};

type GitCommitResponse = PullRequestCommitResponse & {
  push?: {
    pushId?: number;
    date?: string;
    pushedBy?: CommentAuthorResponse;
  };
  changes?: GitDiffChangeResponse[];
};

type WiqlResponse = {
  queryType?: string;
  queryResultType?: string;
  asOf?: string;
  columns?: Array<{ name?: string; referenceName?: string }>;
  workItems?: Array<{ id: number; url?: string }>;
};

type WorkItemResponse = {
  id: number;
  rev?: number;
  fields?: Record<string, unknown>;
  relations?: WorkItemRelationResponse[];
  url?: string;
};

type WorkItemRelationResponse = {
  rel?: string;
  url?: string;
  attributes?: {
    name?: string;
    [key: string]: unknown;
  };
};

type BuildResponse = {
  id: number;
  buildNumber?: string;
  status?: string;
  result?: string;
  sourceBranch?: string;
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  definition?: {
    id?: number;
    name?: string;
  };
  requestedFor?: {
    displayName?: string;
  };
};

const DEFAULT_API_VERSION = "5.1";
const DEFAULT_PR_REVIEW_TITLE = "Kodgranskning av AI";
const AI_COMMENT_PREFIX = "AI-genererad kommentar:";
const MANAGED_HOOK_MARKER = "# exor-ado-auto-review managed hook";
const SERVER_NAME = "azure-devops-onprem";

type CommentAuthorResponse = {
  id?: string;
  displayName?: string;
  uniqueName?: string;
};

type CommentResponse = {
  workItemId?: number;
  commentId?: number;
  id?: number;
  version?: number;
  text?: string;
  isDeleted?: boolean;
  createdDate?: string;
  modifiedDate?: string;
  createdBy?: CommentAuthorResponse;
  modifiedBy?: CommentAuthorResponse;
};

type CommentListResponse = {
  totalCount?: number;
  count?: number;
  comments?: CommentResponse[];
};

type GitDiffItemResponse = {
  path?: string;
  isFolder?: boolean;
  gitObjectType?: string;
  commitId?: string;
  url?: string;
};

type GitDiffChangeResponse = {
  changeType?: string;
  originalPath?: string;
  item?: GitDiffItemResponse;
};

type GitCommitDiffsResponse = {
  allChangesIncluded?: boolean;
  changeCounts?: Record<string, number>;
  changes?: GitDiffChangeResponse[];
  commonCommit?: string;
  aheadCount?: number;
  behindCount?: number;
};

type GitCommitChangesResponse = {
  changeCounts?: Record<string, number>;
  changes?: GitDiffChangeResponse[];
};

type GitItemContentMetadataResponse = {
  fileName?: string;
  extension?: string;
  contentType?: string;
  encoding?: number;
  isBinary?: boolean;
  isImage?: boolean;
};

type GitItemResponse = {
  path?: string;
  content?: string;
  contentMetadata?: GitItemContentMetadataResponse;
  gitObjectType?: string;
  isFolder?: boolean;
  commitId?: string;
  objectId?: string;
};

type PullRequestCommentResponse = {
  id?: number;
  parentCommentId?: number;
  content?: string;
  publishedDate?: string;
  lastUpdatedDate?: string;
  isDeleted?: boolean;
  commentType?: string | number;
  author?: CommentAuthorResponse;
};

type PullRequestThreadResponse = {
  id?: number;
  status?: string | number;
  isDeleted?: boolean;
  publishedDate?: string;
  lastUpdatedDate?: string;
  threadContext?: {
    filePath?: string;
  } | null;
  comments?: PullRequestCommentResponse[];
};

const tools: Tool[] = [
  {
    name: "ado_connection_info",
    description: "Show current Azure DevOps Server MCP configuration and auth mode.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "ado_list_projects",
    description: "List available Azure DevOps projects from the configured on-prem server.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "ado_list_repositories",
    description: "List repositories for a project in Azure DevOps Server.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ado_list_pull_requests",
    description: "List pull requests for a repository in Azure DevOps Server.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
        repository: {
          type: "string",
          description: "Repository name or id.",
        },
        status: {
          type: "string",
          enum: ["active", "completed", "abandoned", "all"],
        },
        sourceRefName: {
          type: "string",
          description: "Optional source ref filter, for example refs/heads/my-branch.",
        },
        top: {
          type: "number",
          minimum: 1,
          maximum: 100,
        },
      },
      required: ["repository"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_get_pull_request",
    description: "Get a specific pull request with repository and commit metadata.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
        repository: {
          type: "string",
          description: "Repository name or id.",
        },
        pullRequestId: {
          type: "number",
          minimum: 1,
        },
      },
      required: ["repository", "pullRequestId"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_list_pull_request_commits",
    description: "List commits included in a specific pull request.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
        repository: {
          type: "string",
          description: "Repository name or id.",
        },
        pullRequestId: {
          type: "number",
          minimum: 1,
        },
        top: {
          type: "number",
          minimum: 1,
          maximum: 200,
        },
      },
      required: ["repository", "pullRequestId"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_get_pull_request_diff",
    description: "Get review-friendly diff text for changed files in a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
        repository: {
          type: "string",
          description: "Repository name or id.",
        },
        pullRequestId: {
          type: "number",
          minimum: 1,
        },
        top: {
          type: "number",
          minimum: 1,
          maximum: 500,
          description: "Maximum number of changed items to read from Azure DevOps before filtering folders.",
        },
        maxFiles: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of files to include in the generated diff output.",
        },
        maxPatchLines: {
          type: "number",
          minimum: 20,
          maximum: 2000,
          description: "Maximum number of diff lines per file before truncation.",
        },
      },
      required: ["repository", "pullRequestId"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_list_pull_request_threads",
    description: "List existing comment threads for a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
        repository: {
          type: "string",
          description: "Repository name or id.",
        },
        pullRequestId: {
          type: "number",
          minimum: 1,
        },
      },
      required: ["repository", "pullRequestId"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_add_pull_request_comment",
    description: "Add an AI-formatted summary comment to a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
        repository: {
          type: "string",
          description: "Repository name or id.",
        },
        pullRequestId: {
          type: "number",
          minimum: 1,
        },
        title: {
          type: "string",
          description: "Optional comment title. Defaults to 'Kodgranskning av AI'.",
        },
        text: {
          type: "string",
          description: "Comment body text.",
        },
      },
      required: ["repository", "pullRequestId", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_update_pull_request_comment",
    description: "Update an existing AI-formatted pull request comment.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
        repository: {
          type: "string",
          description: "Repository name or id.",
        },
        pullRequestId: {
          type: "number",
          minimum: 1,
        },
        threadId: {
          type: "number",
          minimum: 1,
        },
        commentId: {
          type: "number",
          minimum: 1,
        },
        title: {
          type: "string",
          description: "Optional comment title. Defaults to 'Kodgranskning av AI'.",
        },
        text: {
          type: "string",
          description: "Updated comment body text.",
        },
      },
      required: ["repository", "pullRequestId", "threadId", "commentId", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_get_commit_diff",
    description: "Get review-friendly diff text for a specific commit.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
        repository: {
          type: "string",
          description: "Repository name or id.",
        },
        commitId: {
          type: "string",
          description: "Commit SHA to review.",
        },
        top: {
          type: "number",
          minimum: 1,
          maximum: 500,
          description: "Maximum number of changed items to read before folder filtering.",
        },
        maxFiles: {
          type: "number",
          minimum: 1,
          maximum: 100,
        },
        maxPatchLines: {
          type: "number",
          minimum: 20,
          maximum: 2000,
        },
      },
      required: ["repository", "commitId"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_query_wiql",
    description: "Run a read-only WIQL query and return matching work item ids.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
        query: {
          type: "string",
          description: "A WIQL query string.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_get_work_items",
    description: "Fetch work items in batch by ids from Azure DevOps Server.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: {
            type: "number",
          },
          minItems: 1,
          maxItems: 200,
        },
        fields: {
          type: "array",
          items: {
            type: "string",
          },
        },
        expand: {
          type: "string",
          enum: ["none", "relations", "fields", "links", "all"],
          description: "Optional work item expand mode. Use 'relations' or 'all' to include linked artifacts.",
        },
      },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_get_work_item_code_links",
    description: "Resolve associated completed pull requests and direct commits from a work item's linked development artifacts, with duplicate merge chains collapsed for faster review.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
        workItemId: {
          type: "number",
          minimum: 1,
        },
        includeActivePullRequests: {
          type: "boolean",
          description: "When true, include active PRs in addition to completed PRs. Abandoned PRs are always skipped.",
        },
      },
      required: ["workItemId"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_list_builds",
    description: "List builds for a project in Azure DevOps Server.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project name. Falls back to ADO_DEFAULT_PROJECT.",
        },
        top: {
          type: "number",
          minimum: 1,
          maximum: 100,
        },
        branchName: {
          type: "string",
        },
        statusFilter: {
          type: "string",
        },
        definitionIds: {
          type: "array",
          items: {
            type: "number",
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ado_list_work_item_comments",
    description: "List comments for a work item in Azure DevOps Server.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: {
          type: "number",
          minimum: 1,
        },
        top: {
          type: "number",
          minimum: 1,
          maximum: 200,
        },
        includeDeleted: {
          type: "boolean",
        },
      },
      required: ["workItemId"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_add_work_item_comment",
    description: "Add an AI-formatted comment to a work item in Azure DevOps Server.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: {
          type: "number",
          minimum: 1,
        },
        title: {
          type: "string",
          description: "Comment title shown below the AI-generated comment prefix.",
        },
        text: {
          type: "string",
          description: "Comment body text.",
        },
      },
      required: ["workItemId", "title", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "ado_update_work_item_comment",
    description: "Update a work item comment using the AI comment format.",
    inputSchema: {
      type: "object",
      properties: {
        workItemId: {
          type: "number",
          minimum: 1,
        },
        commentId: {
          type: "number",
          minimum: 1,
        },
        title: {
          type: "string",
          description: "Comment title shown below the AI-generated comment prefix.",
        },
        text: {
          type: "string",
          description: "Updated comment body text.",
        },
      },
      required: ["workItemId", "commentId", "title", "text"],
      additionalProperties: false,
    },
  },
];

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/[\\/]+$/, "");
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function toTextResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTextBodyAsHtml(text: string): string {
  const normalizedLines = text.replace(/\r\n/g, "\n").split("\n");
  const htmlParts: string[] = [];
  let currentListType: "ol" | "ul" | null = null;

  const closeList = () => {
    if (currentListType) {
      htmlParts.push(`</${currentListType}>`);
      currentListType = null;
    }
  };

  for (const rawLine of normalizedLines) {
    const line = rawLine.trim();

    if (!line) {
      closeList();
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      if (currentListType !== "ol") {
        closeList();
        htmlParts.push("<ol>");
        currentListType = "ol";
      }

      htmlParts.push(`<li>${escapeHtml(orderedMatch[1])}</li>`);
      continue;
    }

    const unorderedMatch = line.match(/^-\s+(.*)$/);
    if (unorderedMatch) {
      if (currentListType !== "ul") {
        closeList();
        htmlParts.push("<ul>");
        currentListType = "ul";
      }

      htmlParts.push(`<li>${escapeHtml(unorderedMatch[1])}</li>`);
      continue;
    }

    closeList();
    htmlParts.push(`<p>${escapeHtml(line)}</p>`);
  }

  closeList();
  return htmlParts.join("");
}

function formatAiGeneratedComment(title: string, text: string): string {
  const trimmedTitle = title.trim();
  const trimmedText = text.trim();

  if (!trimmedTitle) {
    throw new Error("title är obligatorisk.");
  }

  if (!trimmedText) {
    throw new Error("text är obligatorisk.");
  }

  return `<p><i>${escapeHtml(AI_COMMENT_PREFIX)}</i></p><p>&nbsp;</p><p><strong>${escapeHtml(trimmedTitle)}</strong></p>${formatTextBodyAsHtml(trimmedText)}`;
}

function mapComment(comment: CommentResponse) {
  return {
    workItemId: comment.workItemId,
    commentId: comment.commentId ?? comment.id,
    version: comment.version,
    text: comment.text,
    isDeleted: comment.isDeleted ?? false,
    createdDate: comment.createdDate,
    modifiedDate: comment.modifiedDate,
    createdBy: comment.createdBy?.displayName ?? comment.createdBy?.uniqueName,
    modifiedBy: comment.modifiedBy?.displayName ?? comment.modifiedBy?.uniqueName,
  };
}

function mapPullRequest(pullRequest: PullRequestResponse) {
  return {
    id: pullRequest.pullRequestId,
    title: pullRequest.title,
    description: pullRequest.description,
    status: pullRequest.status,
    isDraft: pullRequest.isDraft ?? false,
    mergeStatus: pullRequest.mergeStatus,
    creationDate: pullRequest.creationDate,
    closedDate: pullRequest.closedDate,
    sourceRefName: pullRequest.sourceRefName,
    targetRefName: pullRequest.targetRefName,
    createdBy: pullRequest.createdBy?.displayName ?? pullRequest.createdBy?.uniqueName,
    repository: {
      id: pullRequest.repository?.id,
      name: pullRequest.repository?.name,
    },
    lastMergeSourceCommitId: pullRequest.lastMergeSourceCommit?.commitId,
    lastMergeTargetCommitId: pullRequest.lastMergeTargetCommit?.commitId,
    lastMergeCommitId: pullRequest.lastMergeCommit?.commitId,
    reviewers: (pullRequest.reviewers ?? []).map((reviewer) => ({
      name: reviewer.displayName,
      vote: reviewer.vote,
    })),
    url: pullRequest.url,
  };
}

function mapPullRequestComment(comment: PullRequestCommentResponse) {
  return {
    id: comment.id,
    parentCommentId: comment.parentCommentId,
    content: comment.content,
    publishedDate: comment.publishedDate,
    lastUpdatedDate: comment.lastUpdatedDate,
    isDeleted: comment.isDeleted ?? false,
    author: comment.author?.displayName ?? comment.author?.uniqueName,
    commentType: comment.commentType,
  };
}

function mapPullRequestThread(thread: PullRequestThreadResponse) {
  return {
    id: thread.id,
    status: thread.status,
    isDeleted: thread.isDeleted ?? false,
    publishedDate: thread.publishedDate,
    lastUpdatedDate: thread.lastUpdatedDate,
    filePath: thread.threadContext?.filePath ?? null,
    comments: (thread.comments ?? []).map(mapPullRequestComment),
  };
}

function truncate(value: string, maxLength = 800): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function truncateLines(value: string, maxLines: number, maxChars = 30000) {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines.length > maxLines) {
    return {
      text: `${lines.slice(0, maxLines).join("\n")}\n... [diff truncated after ${maxLines} lines]`,
      truncated: true,
    };
  }

  if (normalized.length > maxChars) {
    return {
      text: `${normalized.slice(0, maxChars)}\n... [diff truncated after ${maxChars} characters]`,
      truncated: true,
    };
  }

  return {
    text: normalized,
    truncated: false,
  };
}

function normalizeCollection<T>(response: CollectionListResponse<T> | T[]): T[] {
  return Array.isArray(response) ? response : (response.value ?? []);
}

function isTextReviewableItem(item: GitItemResponse | undefined) {
  if (!item || item.isFolder) {
    return false;
  }

  if (item.contentMetadata?.isBinary || item.contentMetadata?.isImage) {
    return false;
  }

  return typeof item.content === "string";
}

function mapWorkItemRelation(relation: WorkItemRelationResponse) {
  return {
    rel: relation.rel,
    name: relation.attributes?.name,
    url: relation.url,
    attributes: relation.attributes ?? {},
  };
}

function mapWorkItem(workItem: WorkItemResponse, includeRelations = false) {
  return {
    id: workItem.id,
    rev: workItem.rev,
    url: workItem.url,
    fields: workItem.fields ?? {},
    relations: includeRelations ? (workItem.relations ?? []).map(mapWorkItemRelation) : undefined,
  };
}

function parseGitArtifactUrl(url: string | undefined) {
  if (!url) {
    return undefined;
  }

  const decoded = decodeURIComponent(url);

  if (decoded.startsWith("vstfs:///Git/PullRequestId/")) {
    const payload = decoded.slice("vstfs:///Git/PullRequestId/".length).split("/");
    if (payload.length >= 3) {
      const pullRequestId = Number(payload[2]);
      if (Number.isFinite(pullRequestId) && pullRequestId > 0) {
        return {
          artifactType: "pullRequest" as const,
          projectId: payload[0],
          repositoryId: payload[1],
          pullRequestId,
        };
      }
    }
  }

  if (decoded.startsWith("vstfs:///Git/Commit/")) {
    const payload = decoded.slice("vstfs:///Git/Commit/".length).split("/");
    if (payload.length >= 3) {
      return {
        artifactType: "commit" as const,
        projectId: payload[0],
        repositoryId: payload[1],
        commitId: payload.slice(2).join("/"),
      };
    }
  }

  return undefined;
}

function normalizeCommitId(commitId: string | undefined) {
  const normalized = commitId?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isGitCommitId(commitId: string | undefined) {
  const normalized = normalizeCommitId(commitId);
  return normalized ? /^[0-9a-f]{40}$/i.test(normalized) : false;
}

function collectPullRequestReviewCommitIds(pullRequest: PullRequestResponse, commits: PullRequestCommitResponse[]) {
  const commitIds = new Set<string>();

  for (const commitId of [
    pullRequest.lastMergeSourceCommit?.commitId,
    pullRequest.lastMergeCommit?.commitId,
    ...commits.map((commit) => commit.commitId),
  ]) {
    if (!isGitCommitId(commitId)) {
      continue;
    }

    commitIds.add(normalizeCommitId(commitId)!);
  }

  return [...commitIds].sort();
}

function getPullRequestDeduplicationKeys(pullRequest: PullRequestResponse, reviewCommitIds: string[]) {
  const keys: string[] = [];
  const sourceCommitId = normalizeCommitId(pullRequest.lastMergeSourceCommit?.commitId);
  const mergeCommitId = normalizeCommitId(pullRequest.lastMergeCommit?.commitId);

  if (isGitCommitId(sourceCommitId)) {
    keys.push(`source:${sourceCommitId}`);
  }

  if (reviewCommitIds.length > 0) {
    keys.push(`commits:${reviewCommitIds.join(",")}`);
  }

  if (isGitCommitId(mergeCommitId)) {
    keys.push(`merge:${mergeCommitId}`);
  }

  return keys;
}

function getPullRequestSortTimestamp(pullRequest: PullRequestResponse) {
  const timestamps = [pullRequest.closedDate, pullRequest.creationDate]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);

  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
}

async function buildReviewDiffFiles(
  config: ServerConfig,
  project: string,
  repository: string,
  changes: GitDiffChangeResponse[],
  oldCommitId: string | undefined,
  newCommitId: string,
  maxFiles: number,
  maxPatchLines: number,
) {
  const candidateChanges = changes.filter((change) => !change.item?.isFolder).slice(0, maxFiles);

  return Promise.all(
    candidateChanges.map(async (change) => {
      const currentPath = change.item?.path;
      const originalPath = change.originalPath ?? currentPath;
      const changeType = change.changeType ?? "unknown";

      if (!currentPath && !originalPath) {
        return {
          path: null,
          originalPath: null,
          changeType,
          skipped: true,
          skippedReason: "Changed item saknar path.",
        };
      }

      const isAdd = changeType.includes("add");
      const isDelete = changeType.includes("delete");
      const shouldReadOld = !isAdd && !!oldCommitId;
      const shouldReadNew = !isDelete;

      const [oldItem, newItem] = await Promise.all([
        shouldReadOld && originalPath && oldCommitId
          ? getGitItemAtCommit(config, project, repository, originalPath, oldCommitId)
          : Promise.resolve(undefined),
        shouldReadNew && currentPath ? getGitItemAtCommit(config, project, repository, currentPath, newCommitId) : Promise.resolve(undefined),
      ]);

      if ((oldItem && !isTextReviewableItem(oldItem)) || (newItem && !isTextReviewableItem(newItem))) {
        return {
          path: currentPath ?? originalPath ?? null,
          originalPath: originalPath ?? null,
          changeType,
          skipped: true,
          skippedReason: "Filen verkar vara binär, bild eller saknar textinnehåll.",
        };
      }

      const oldContent = oldItem?.content ?? "";
      const newContent = newItem?.content ?? "";
      const patch = createTwoFilesPatch(
        originalPath ?? currentPath ?? "before",
        currentPath ?? originalPath ?? "after",
        oldContent,
        newContent,
        oldCommitId ?? "",
        newCommitId,
      );
      const truncatedPatch = truncateLines(patch, maxPatchLines);

      return {
        path: currentPath ?? originalPath ?? null,
        originalPath: originalPath ?? null,
        changeType,
        skipped: false,
        patch: truncatedPatch.text,
        patchTruncated: truncatedPatch.truncated,
      };
    }),
  );
}

function resolveAuth(config: NodeJS.ProcessEnv): Pick<ServerConfig, "authHeader" | "authMode"> {
  const useDefaultCredentials = config.ADO_USE_DEFAULT_CREDENTIALS?.trim().toLowerCase();
  if (useDefaultCredentials === "true" || useDefaultCredentials === "1" || useDefaultCredentials === "yes") {
    return {
      authMode: "windows",
    };
  }

  const explicitHeader = config.ADO_AUTH_HEADER?.trim();
  if (explicitHeader) {
    return {
      authHeader: explicitHeader,
      authMode: "header",
    };
  }

  const pat = config.ADO_PAT?.trim();
  if (pat) {
    return {
      authHeader: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
      authMode: "pat",
    };
  }

  const basicUsername = config.ADO_BASIC_USERNAME?.trim();
  const basicPassword = config.ADO_BASIC_PASSWORD ?? "";
  if (basicUsername) {
    return {
      authHeader: `Basic ${Buffer.from(`${basicUsername}:${basicPassword}`).toString("base64")}`,
      authMode: "basic",
    };
  }

  if (process.platform === "win32") {
    return {
      authMode: "windows",
    };
  }

  return {
    authMode: "anonymous",
  };
}

function readConfigFromValues(values: Record<string, string | undefined>): ServerConfig {
  const auth = resolveAuth(values);
  const baseUrl = values.ADO_BASE_URL?.trim();

  if (!baseUrl) {
    throw new Error("ADO_BASE_URL saknas. Ange collection-URL till Azure DevOps Server.");
  }

  const apiVersion = values.ADO_API_VERSION?.trim() || DEFAULT_API_VERSION;

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiVersion,
    commentsApiVersion: values.ADO_COMMENTS_API_VERSION?.trim() || `${apiVersion}-preview.3`,
    defaultProject: values.ADO_DEFAULT_PROJECT?.trim() || undefined,
    authHeader: auth.authHeader,
    authMode: auth.authMode,
    useDefaultCredentials: auth.authMode === "windows",
  };
}

function readConfig(): ServerConfig {
  return readConfigFromValues(process.env);
}

function ensureProject(project: string | undefined, config: ServerConfig): string {
  const resolvedProject = project?.trim() || config.defaultProject;
  if (!resolvedProject) {
    throw new Error("Projekt saknas. Ange project i tool-anropet eller sätt ADO_DEFAULT_PROJECT.");
  }

  return resolvedProject;
}

function buildUrl(config: ServerConfig, path: string, query: QueryParams = {}): URL {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${config.baseUrl}${normalizedPath}`);
  url.searchParams.set("api-version", config.apiVersion);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url;
}

async function adoRequest<T>(
  config: ServerConfig,
  path: string,
  init?: RequestInit,
  query?: QueryParams,
): Promise<T> {
  if (config.useDefaultCredentials) {
    return powershellAdoRequest<T>(config, path, init, query);
  }

  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");

  if (init?.body) {
    headers.set("Content-Type", "application/json");
  }

  if (config.authHeader) {
    headers.set("Authorization", config.authHeader);
  }

  const response = await fetch(buildUrl(config, path, query), {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = truncate(await response.text());
    throw new Error(`Azure DevOps-anrop misslyckades (${response.status} ${response.statusText}): ${body}`);
  }

  return (await response.json()) as T;
}

const execFileAsync = promisify(execFile);

async function powershellAdoRequest<T>(
  config: ServerConfig,
  path: string,
  init?: RequestInit,
  query?: QueryParams,
): Promise<T> {
  const url = buildUrl(config, path, query).toString();
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : "";

  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$headers = @{ Accept = 'application/json' }
$params = @{
  Uri = $env:REQUEST_URL
  Method = $env:REQUEST_METHOD
  UseDefaultCredentials = $true
  AllowUnencryptedAuthentication = $true
  Headers = $headers
}
if ($env:REQUEST_BODY) {
  $params['ContentType'] = 'application/json'
  $params['Body'] = $env:REQUEST_BODY
}
$response = Invoke-WebRequest @params
[Console]::Out.Write($response.Content)
`;

  const encodedScript = Buffer.from(script, "utf16le").toString("base64");
  const shell = process.platform === "win32" ? "pwsh" : "pwsh";
  const { stdout, stderr } = await execFileAsync(shell, ["-NoProfile", "-EncodedCommand", encodedScript], {
    env: {
      ...process.env,
      REQUEST_URL: url,
      REQUEST_METHOD: method,
      REQUEST_BODY: body,
    },
    maxBuffer: 10 * 1024 * 1024,
  });

  if (stderr?.trim()) {
    throw new Error(truncate(stderr.trim()));
  }

  return JSON.parse(stdout) as T;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const numbers = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  return numbers.length > 0 ? numbers : [];
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return values.length > 0 ? values : [];
}

async function getPullRequest(
  config: ServerConfig,
  project: string,
  repository: string,
  pullRequestId: number,
) {
  return adoRequest<PullRequestResponse>(
    config,
    `/${encodePathSegment(project)}/_apis/git/repositories/${encodePathSegment(repository)}/pullRequests/${pullRequestId}`,
  );
}

async function getGitItemAtCommit(
  config: ServerConfig,
  project: string,
  repository: string,
  path: string,
  commitId: string,
) {
  return adoRequest<GitItemResponse>(
    config,
    `/${encodePathSegment(project)}/_apis/git/repositories/${encodePathSegment(repository)}/items`,
    undefined,
    {
      path,
      includeContent: "true",
      includeContentMetadata: "true",
      "$format": "json",
      "versionDescriptor.version": commitId,
      "versionDescriptor.versionType": "commit",
    },
  );
}

async function getWorkItem(
  config: ServerConfig,
  _project: string,
  workItemId: number,
  expand?: string,
) {
  return adoRequest<WorkItemResponse>(
    config,
    `/_apis/wit/workitems/${workItemId}`,
    undefined,
    {
      "$expand": expand,
    },
  );
}

async function getCommit(
  config: ServerConfig,
  project: string,
  repository: string,
  commitId: string,
) {
  return adoRequest<GitCommitResponse>(
    config,
    `/${encodePathSegment(project)}/_apis/git/repositories/${encodePathSegment(repository)}/commits/${encodePathSegment(commitId)}`,
  );
}

async function getCommitChanges(
  config: ServerConfig,
  project: string,
  repository: string,
  commitId: string,
  top: number,
) {
  return adoRequest<GitCommitChangesResponse>(
    config,
    `/${encodePathSegment(project)}/_apis/git/repositories/${encodePathSegment(repository)}/commits/${encodePathSegment(commitId)}/changes`,
    undefined,
    {
      top,
    },
  );
}

async function listPullRequests(
  config: ServerConfig,
  project: string,
  repository: string,
  options: {
    status?: string;
    top?: number;
    sourceRefName?: string;
  } = {},
) {
  const response = await adoRequest<CollectionListResponse<PullRequestResponse>>(
    config,
    `/${encodePathSegment(project)}/_apis/git/repositories/${encodePathSegment(repository)}/pullrequests`,
    undefined,
    {
      "searchCriteria.status": options.status ?? "active",
      "searchCriteria.sourceRefName": options.sourceRefName,
      "$top": options.top ?? 25,
    },
  );

  return response.value ?? [];
}

async function listPullRequestThreads(config: ServerConfig, project: string, repository: string, pullRequestId: number) {
  const response = await adoRequest<CollectionListResponse<PullRequestThreadResponse> | PullRequestThreadResponse[]>(
    config,
    `/${encodePathSegment(project)}/_apis/git/repositories/${encodePathSegment(repository)}/pullRequests/${pullRequestId}/threads`,
  );
  return normalizeCollection(response);
}

async function addPullRequestComment(
  config: ServerConfig,
  project: string,
  repository: string,
  pullRequestId: number,
  title: string,
  text: string,
) {
  return adoRequest<PullRequestThreadResponse>(
    config,
    `/${encodePathSegment(project)}/_apis/git/repositories/${encodePathSegment(repository)}/pullRequests/${pullRequestId}/threads`,
    {
      method: "POST",
      body: JSON.stringify({
        comments: [
          {
            parentCommentId: 0,
            content: formatAiGeneratedComment(title, text),
            commentType: 1,
          },
        ],
        status: 1,
      }),
    },
  );
}

async function updatePullRequestComment(
  config: ServerConfig,
  project: string,
  repository: string,
  pullRequestId: number,
  threadId: number,
  commentId: number,
  title: string,
  text: string,
) {
  return adoRequest<PullRequestCommentResponse>(
    config,
    `/${encodePathSegment(project)}/_apis/git/repositories/${encodePathSegment(repository)}/pullRequests/${pullRequestId}/threads/${threadId}/comments/${commentId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        content: formatAiGeneratedComment(title, text),
      }),
    },
  );
}

async function getPullRequestDiffResult(
  config: ServerConfig,
  project: string,
  repository: string,
  pullRequestId: number,
  options: {
    top?: number;
    maxFiles?: number;
    maxPatchLines?: number;
  } = {},
) {
  const maxFiles = Math.min(options.maxFiles ?? 20, 100);
  const maxPatchLines = Math.min(options.maxPatchLines ?? 400, 2000);
  const pullRequest = await getPullRequest(config, project, repository, pullRequestId);
  const sourceCommitId = pullRequest.lastMergeSourceCommit?.commitId;
  const targetCommitId = pullRequest.lastMergeTargetCommit?.commitId;

  if (!sourceCommitId || !targetCommitId) {
    throw new Error("Pull request saknar commit-information för diff. lastMergeSourceCommit och lastMergeTargetCommit krävs.");
  }

  const diffResponse = await adoRequest<GitCommitDiffsResponse>(
    config,
    `/${encodePathSegment(project)}/_apis/git/repositories/${encodePathSegment(repository)}/diffs/commits`,
    undefined,
    {
      "$top": options.top ?? 200,
      diffCommonCommit: "false",
      baseVersion: targetCommitId,
      baseVersionType: "commit",
      targetVersion: sourceCommitId,
      targetVersionType: "commit",
    },
  );

  const files = await buildReviewDiffFiles(
    config,
    project,
    repository,
    diffResponse.changes ?? [],
    targetCommitId,
    sourceCommitId,
    maxFiles,
    maxPatchLines,
  );

  return {
    pullRequest,
    sourceCommitId,
    targetCommitId,
    diffSummary: {
      allChangesIncluded: diffResponse.allChangesIncluded ?? false,
      changeCounts: diffResponse.changeCounts ?? {},
      commonCommit: diffResponse.commonCommit,
      aheadCount: diffResponse.aheadCount,
      behindCount: diffResponse.behindCount,
    },
    includedFileCount: files.length,
    files,
  };
}

function resolvePluginRoot() {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const baseDirName = path.basename(currentDir).toLowerCase();
  return baseDirName === "src" || baseDirName === "dist" ? path.dirname(currentDir) : currentDir;
}

function normalizePathForComparison(value: string) {
  return path.resolve(value).replace(/\//g, "\\").toLowerCase();
}

function getUserConfigCandidates() {
  const homeDir = os.homedir();
  return [
    path.join(homeDir, ".copilot", "mcp-config.json"),
    path.join(homeDir, ".codex", "mcp-config.json"),
    path.join(homeDir, ".claude", "mcp-config.json"),
  ];
}

function getServerEntries(config: LocalConfigFile): Array<{ serverName: string; entry: LocalConfigServerEntry }> {
  const entries = Object.entries(config.mcpServers ?? config.servers ?? {});
  return entries.map(([serverName, entry]) => ({ serverName, entry }));
}

function serverEntryMatchesPlugin(entry: LocalConfigServerEntry, pluginRoot: string) {
  const normalizedPluginRoot = normalizePathForComparison(pluginRoot);
  const values = [entry.command, ...(entry.args ?? [])].filter((value): value is string => typeof value === "string");
  return values.some((value) => {
    const normalizedValue = value.replace(/^["']|["']$/g, "");
    if (!path.isAbsolute(normalizedValue)) {
      return normalizedValue.toLowerCase().includes("azure-devops-onprem-mcp");
    }

    return normalizePathForComparison(normalizedValue).includes(normalizedPluginRoot);
  });
}

async function readJsonFile<T>(filePath: string) {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

function getPluginSettingsEntry(config: LocalConfigFile) {
  return config.pluginSettings?.[SERVER_NAME] ?? config.plugins?.[SERVER_NAME];
}

function normalizeStringRecord(values: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => typeof value === "string"),
  ) as Record<string, string>;
}

async function readRepoServerEnv(pluginRoot: string, repoRoot: string) {
  const candidatePaths = [path.join(repoRoot, ".mcp.json"), path.join(repoRoot, "mcp-config.json")];

  for (const filePath of candidatePaths) {
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const config = await readJsonFile<LocalConfigFile>(filePath);
      const matchingEntry = getServerEntries(config).find(({ entry }) => serverEntryMatchesPlugin(entry, pluginRoot));
      if (matchingEntry?.entry.env) {
        return matchingEntry.entry.env;
      }
    } catch (error) {
      console.error(`Kunde inte läsa repo-konfig ${filePath}: ${truncate(String(error))}`);
    }
  }

  return undefined;
}

async function readLocalAutomationSettings(pluginRoot: string, repoRoot?: string): Promise<LocalAutomationSettings | undefined> {
  for (const filePath of getUserConfigCandidates()) {
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const config = await readJsonFile<LocalConfigFile>(filePath);
      const matchingEntry = getServerEntries(config).find(({ entry }) => serverEntryMatchesPlugin(entry, pluginRoot));
      const pluginSettings = getPluginSettingsEntry(config);
      const automaticCodeReviewPR =
        matchingEntry?.entry.automaticCodeReviewPR === true || pluginSettings?.automaticCodeReviewPR === true;
      const automaticCodeReviewPRCommand =
        asString(matchingEntry?.entry.automaticCodeReviewPRCommand) ?? asString(pluginSettings?.automaticCodeReviewPRCommand);

      if (!matchingEntry && !pluginSettings) {
        continue;
      }

      const entryEnv = matchingEntry?.entry.env ? normalizeStringRecord(matchingEntry.entry.env) : undefined;
      const processEnv = normalizeStringRecord(
        Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("ADO_"))),
      );
      const env = entryEnv ?? (repoRoot ? await readRepoServerEnv(pluginRoot, repoRoot) : undefined) ?? processEnv;

      if (!env.ADO_BASE_URL) {
        continue;
      }

      if (!matchingEntry) {
        return {
          automaticCodeReviewPR,
          automaticCodeReviewPRCommand,
          serverName: SERVER_NAME,
          configFilePath: filePath,
          env,
        };
      }

      return {
        automaticCodeReviewPR,
        automaticCodeReviewPRCommand,
        serverName: matchingEntry.serverName,
        configFilePath: filePath,
        env,
      };
    } catch (error) {
      console.error(`Kunde inte läsa lokal MCP-konfig ${filePath}: ${truncate(String(error))}`);
    }
  }

  return undefined;
}

async function runGitCommand(args: string[], cwd: string) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function resolveGitRepoRoot(startDir: string) {
  try {
    const resolved = await runGitCommand(["rev-parse", "--show-toplevel"], startDir);
    return resolved || undefined;
  } catch {
    return undefined;
  }
}

async function resolveWorkspaceRepoRoot() {
  const candidates = [
    process.env.ADO_WORKSPACE_REPO_ROOT,
    process.env.INIT_CWD,
    process.cwd(),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const candidate of candidates) {
    const repoRoot = await resolveGitRepoRoot(candidate);
    if (repoRoot) {
      return repoRoot;
    }
  }

  return undefined;
}

function getManagedHookPath(repoRoot: string) {
  return path.join(repoRoot, ".git", "hooks", "pre-push");
}

function buildManagedHookScript(pluginRoot: string) {
  const nodePath = process.execPath.replace(/\\/g, "/");
  const tsxPath = path.join(pluginRoot, "node_modules", "tsx", "dist", "cli.mjs").replace(/\\/g, "/");
  const entryPath = path.join(pluginRoot, "src", "index.ts").replace(/\\/g, "/");

  return `#!/bin/sh
${MANAGED_HOOK_MARKER}
REMOTE_NAME="$1"
REMOTE_URL="$2"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
CURRENT_COMMIT=$(git rev-parse HEAD 2>/dev/null)
if [ -z "$REPO_ROOT" ] || [ -z "$CURRENT_BRANCH" ] || [ "$CURRENT_BRANCH" = "HEAD" ] || [ -z "$CURRENT_COMMIT" ]; then
  exit 0
fi
"${nodePath}" "${tsxPath}" "${entryPath}" auto-review-trigger --repo-root "$REPO_ROOT" --branch "$CURRENT_BRANCH" --commit "$CURRENT_COMMIT" --remote-name "$REMOTE_NAME" --remote-url "$REMOTE_URL" >/dev/null 2>&1 &
exit 0
`;
}

async function syncManagedHook(repoRoot: string, pluginRoot: string, enabled: boolean) {
  const hookPath = getManagedHookPath(repoRoot);
  const hookDir = path.dirname(hookPath);
  await mkdir(hookDir, { recursive: true });

  if (!enabled) {
    if (!existsSync(hookPath)) {
      return;
    }

    const currentContent = await readFile(hookPath, "utf8");
    if (currentContent.includes(MANAGED_HOOK_MARKER)) {
      await rm(hookPath, { force: true });
    }
    return;
  }

  const nextContent = buildManagedHookScript(pluginRoot);
  const currentContent = existsSync(hookPath) ? await readFile(hookPath, "utf8") : undefined;
  if (currentContent === nextContent) {
    return;
  }

  if (currentContent && !currentContent.includes(MANAGED_HOOK_MARKER)) {
    throw new Error(`Git-hook finns redan i ${hookPath}. Pluginet skriver inte över en befintlig användarhook.`);
  }

  await writeFile(hookPath, nextContent, "utf8");
  await chmod(hookPath, 0o755).catch(() => undefined);
}

async function maybeSyncAutoReviewHook() {
  const pluginRoot = resolvePluginRoot();
  const repoRoot = await resolveWorkspaceRepoRoot();
  if (!repoRoot) {
    return;
  }

  const settings = await readLocalAutomationSettings(pluginRoot, repoRoot);
  if (!settings) {
    return;
  }

  await syncManagedHook(repoRoot, pluginRoot, settings.automaticCodeReviewPR);
}

function normalizeRemoteIdentity(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\.git$/i, "")
    .replace(/^[^@]+@/, "")
    .replace(/^ssh:\/\//i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

async function resolveRepositoryForWorkspace(config: ServerConfig, project: string, repoRoot: string) {
  const remoteUrl = await runGitCommand(["remote", "get-url", "origin"], repoRoot).catch(() => "");
  const normalizedRemoteUrl = normalizeRemoteIdentity(remoteUrl);
  const repositoriesResponse = await adoRequest<CollectionListResponse<RepositoryResponse>>(
    config,
    `/${encodePathSegment(project)}/_apis/git/repositories`,
  );
  const repositories = repositoriesResponse.value ?? [];

  if (normalizedRemoteUrl) {
    const exactMatch = repositories.find((repository) => normalizeRemoteIdentity(repository.remoteUrl) === normalizedRemoteUrl);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const repoNameFromFolder = path.basename(repoRoot).toLowerCase();
  const nameMatch = repositories.find((repository) => repository.name?.trim().toLowerCase() === repoNameFromFolder);
  if (nameMatch) {
    return nameMatch;
  }

  throw new Error("Kunde inte matcha lokalt git-repo mot repository i Azure DevOps.");
}

type PullRequestReviewState = {
  lastReviewedSourceCommitId?: string;
  threadId?: number;
  commentId?: number;
  updatedAt?: string;
};

type AutoReviewStateFile = {
  pullRequests?: Record<string, PullRequestReviewState>;
};

function getAutoReviewStatePath(repoRoot: string) {
  return path.join(repoRoot, ".git", "ado-auto-review-state.json");
}

async function readAutoReviewState(repoRoot: string): Promise<AutoReviewStateFile> {
  const statePath = getAutoReviewStatePath(repoRoot);
  if (!existsSync(statePath)) {
    return {};
  }

  try {
    return await readJsonFile<AutoReviewStateFile>(statePath);
  } catch {
    return {};
  }
}

async function writeAutoReviewState(repoRoot: string, state: AutoReviewStateFile) {
  await writeFile(getAutoReviewStatePath(repoRoot), JSON.stringify(state, null, 2), "utf8");
}

function buildPullRequestReviewPrompt(params: {
  project: string;
  repository: string;
  pullRequest: ReturnType<typeof mapPullRequest>;
  diff: Awaited<ReturnType<typeof getPullRequestDiffResult>>;
}) {
  const fileSections = params.diff.files
    .map((file) => {
      const patch = typeof file.patch === "string" ? file.patch : `[${file.skippedReason ?? "ingen patch"}]`;
      return `Fil: ${file.path ?? file.originalPath ?? "(okänd)"}\nÄndring: ${file.changeType}\nPatch:\n${patch}`;
    })
    .join("\n\n---\n\n");

  return [
    "Gör en kortfattad men konkret kodgranskning på svenska av denna pull request.",
    "Fokusera på buggar, logiska fel, säkerhetsrisker, ohanterade exceptions, brister i validering och onödig eller misstänkt kod.",
    "Undvik stilkommentarer om de inte påverkar korrekthet tydligt.",
    "Skriv bara själva granskningsinnehållet utan prefixet 'AI-genererad kommentar:' och utan titeln.",
    "",
    `Projekt: ${params.project}`,
    `Repository: ${params.repository}`,
    `Pull request: #${params.pullRequest.id} ${params.pullRequest.title}`,
    `Source ref: ${params.pullRequest.sourceRefName ?? ""}`,
    `Target ref: ${params.pullRequest.targetRefName ?? ""}`,
    `Source commit: ${params.diff.sourceCommitId}`,
    `Target commit: ${params.diff.targetCommitId}`,
    "",
    "Diffsammanfattning:",
    JSON.stringify(params.diff.diffSummary, null, 2),
    "",
    "Ändrade filer:",
    fileSections,
  ].join("\n");
}

async function runConfiguredReviewCommand(command: string, prompt: string, repoRoot: string) {
  const tempDir = await mkdir(path.join(os.tmpdir(), "ado-auto-review"), { recursive: true }).then(() =>
    path.join(os.tmpdir(), "ado-auto-review"),
  );
  const promptFile = path.join(tempDir, `prompt-${process.pid}-${Date.now()}.txt`);
  const outputFile = path.join(tempDir, `output-${process.pid}-${Date.now()}.txt`);

  await writeFile(promptFile, prompt, "utf8");
  await writeFile(outputFile, "", "utf8");

  try {
    await execFileAsync("cmd.exe", ["/d", "/s", "/c", command], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ADO_AUTO_REVIEW_PROMPT_FILE: promptFile,
        ADO_AUTO_REVIEW_OUTPUT_FILE: outputFile,
      },
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = (await readFile(outputFile, "utf8")).trim();
    if (!output) {
      throw new Error("Review-kommandot kördes men skrev ingen output till ADO_AUTO_REVIEW_OUTPUT_FILE.");
    }

    return output;
  } finally {
    await rm(promptFile, { force: true }).catch(() => undefined);
    await rm(outputFile, { force: true }).catch(() => undefined);
  }
}

function findExistingAiReviewThread(threads: PullRequestThreadResponse[]) {
  for (const thread of threads) {
    if (thread.isDeleted) {
      continue;
    }

    for (const comment of thread.comments ?? []) {
      if (comment.isDeleted) {
        continue;
      }

      if (comment.content?.includes(AI_COMMENT_PREFIX) && comment.content?.includes(DEFAULT_PR_REVIEW_TITLE)) {
        return {
          threadId: thread.id,
          commentId: comment.id,
        };
      }
    }
  }

  return undefined;
}

async function waitForPullRequestSourceCommit(
  config: ServerConfig,
  project: string,
  repository: string,
  pullRequestId: number,
  expectedCommitId: string,
  attempts = 12,
  delayMs = 5000,
) {
  let latest = await getPullRequest(config, project, repository, pullRequestId);
  for (let index = 0; index < attempts; index += 1) {
    const currentCommitId = normalizeCommitId(latest.lastMergeSourceCommit?.commitId);
    if (currentCommitId === normalizeCommitId(expectedCommitId)) {
      return latest;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    latest = await getPullRequest(config, project, repository, pullRequestId);
  }

  return latest;
}

function parseCliArgs(argv: string[]) {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      continue;
    }

    result.set(key.slice(2), value);
  }

  return result;
}

async function runAutoReviewTrigger(argv: string[]) {
  const args = parseCliArgs(argv);
  const repoRoot = args.get("repo-root");
  const branch = args.get("branch");
  const expectedCommitId = args.get("commit");

  if (!repoRoot || !branch || !expectedCommitId) {
    throw new Error("auto-review-trigger kräver --repo-root, --branch och --commit.");
  }

  const pluginRoot = resolvePluginRoot();
  const settings = await readLocalAutomationSettings(pluginRoot, repoRoot);
  if (!settings?.automaticCodeReviewPR) {
    return;
  }

  if (!settings.automaticCodeReviewPRCommand) {
    console.error(`automaticCodeReviewPR är aktiverat men automaticCodeReviewPRCommand saknas i ${settings.configFilePath ?? "lokal config"}.`);
    return;
  }

  const config = readConfigFromValues(settings.env);
  const project = ensureProject(undefined, config);
  const repository = await resolveRepositoryForWorkspace(config, project, repoRoot);
  const sourceRefName = `refs/heads/${branch}`;
  const pullRequests = await listPullRequests(config, project, repository.id ?? repository.name ?? "", {
    status: "active",
    sourceRefName,
    top: 10,
  });

  const selectedPullRequest = pullRequests
    .filter((pullRequest) => !pullRequest.isDraft)
    .sort((left, right) => (right.pullRequestId ?? 0) - (left.pullRequestId ?? 0))[0];

  if (!selectedPullRequest?.pullRequestId) {
    return;
  }

  const latestPullRequest = await waitForPullRequestSourceCommit(
    config,
    project,
    repository.id ?? repository.name ?? "",
    selectedPullRequest.pullRequestId,
    expectedCommitId,
  );

  const latestSourceCommitId = normalizeCommitId(latestPullRequest.lastMergeSourceCommit?.commitId);
  if (latestSourceCommitId !== normalizeCommitId(expectedCommitId)) {
    return;
  }

  const state = await readAutoReviewState(repoRoot);
  const stateKey = `${repository.id ?? repository.name}:${selectedPullRequest.pullRequestId}`;
  const existingState = state.pullRequests?.[stateKey];
  if (existingState?.lastReviewedSourceCommitId === latestSourceCommitId) {
    return;
  }

  const diff = await getPullRequestDiffResult(
    config,
    project,
    repository.id ?? repository.name ?? "",
    selectedPullRequest.pullRequestId,
    { maxFiles: 20, maxPatchLines: 500 },
  );

  const prompt = buildPullRequestReviewPrompt({
    project,
    repository: repository.name ?? repository.id ?? "",
    pullRequest: mapPullRequest(diff.pullRequest),
    diff,
  });
  const reviewText = await runConfiguredReviewCommand(settings.automaticCodeReviewPRCommand, prompt, repoRoot);

  const threads = await listPullRequestThreads(config, project, repository.id ?? repository.name ?? "", selectedPullRequest.pullRequestId);
  const matchedThread =
    (existingState?.threadId && existingState.commentId
      ? { threadId: existingState.threadId, commentId: existingState.commentId }
      : undefined) ?? findExistingAiReviewThread(threads);

  let nextState: PullRequestReviewState;

  if (matchedThread?.threadId && matchedThread.commentId) {
    await updatePullRequestComment(
      config,
      project,
      repository.id ?? repository.name ?? "",
      selectedPullRequest.pullRequestId,
      matchedThread.threadId,
      matchedThread.commentId,
      DEFAULT_PR_REVIEW_TITLE,
      reviewText,
    );
    nextState = {
      lastReviewedSourceCommitId: latestSourceCommitId,
      threadId: matchedThread.threadId,
      commentId: matchedThread.commentId,
      updatedAt: new Date().toISOString(),
    };
  } else {
    const createdThread = await addPullRequestComment(
      config,
      project,
      repository.id ?? repository.name ?? "",
      selectedPullRequest.pullRequestId,
      DEFAULT_PR_REVIEW_TITLE,
      reviewText,
    );
    const rootComment = (createdThread.comments ?? [])[0];
    nextState = {
      lastReviewedSourceCommitId: latestSourceCommitId,
      threadId: createdThread.id,
      commentId: rootComment?.id,
      updatedAt: new Date().toISOString(),
    };
  }

  await writeAutoReviewState(repoRoot, {
    ...state,
    pullRequests: {
      ...(state.pullRequests ?? {}),
      [stateKey]: nextState,
    },
  });
}

async function main() {
  await maybeSyncAutoReviewHook().catch((error) => {
    console.error(`Kunde inte synkronisera auto review-hook: ${truncate(String(error))}`);
  });

  const server = new Server(
    {
      name: SERVER_NAME,
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};

    switch (request.params.name) {
      case "ado_connection_info": {
        const config = readConfig();

        return toTextResult({
          server: SERVER_NAME,
          readonly: false,
          commentWriteEnabled: true,
          pullRequestCommentWriteEnabled: true,
          pullRequestApprovalEnabled: false,
          pullRequestDeclineEnabled: false,
          pullRequestVoteEnabled: false,
          workItemCodeReviewLookupEnabled: true,
          workItemFieldWriteEnabled: false,
          baseUrl: config.baseUrl,
          apiVersion: config.apiVersion,
          commentsApiVersion: config.commentsApiVersion,
          defaultProject: config.defaultProject ?? null,
          authMode: config.authMode,
          authConfigured: config.authMode !== "anonymous",
          tools: tools.map((tool) => tool.name),
        });
      }

      case "ado_list_projects": {
        const config = readConfig();
        const response = await adoRequest<CollectionListResponse<ProjectResponse>>(config, "/_apis/projects");

        return toTextResult({
          count: response.count ?? response.value?.length ?? 0,
          projects: (response.value ?? []).map((project) => ({
            id: project.id,
            name: project.name,
            state: project.state,
            visibility: project.visibility,
            lastUpdateTime: project.lastUpdateTime,
            description: project.description,
          })),
        });
      }

      case "ado_list_repositories": {
        const config = readConfig();
        const resolvedProject = ensureProject(asString(args.project), config);
        const response = await adoRequest<CollectionListResponse<RepositoryResponse>>(
          config,
          `/${encodePathSegment(resolvedProject)}/_apis/git/repositories`,
        );

        return toTextResult({
          project: resolvedProject,
          count: response.count ?? response.value?.length ?? 0,
          repositories: (response.value ?? []).map((repository) => ({
            id: repository.id,
            name: repository.name,
            defaultBranch: repository.defaultBranch,
            size: repository.size,
            remoteUrl: repository.remoteUrl,
            webUrl: repository.webUrl,
          })),
        });
      }

      case "ado_list_pull_requests": {
        const config = readConfig();
        const repository = asString(args.repository);
        if (!repository) {
          throw new Error("repository är obligatorisk.");
        }

        const resolvedProject = ensureProject(asString(args.project), config);
        const response = await listPullRequests(config, resolvedProject, repository, {
          status: asString(args.status) ?? "active",
          sourceRefName: asString(args.sourceRefName),
          top: asNumber(args.top) ?? 25,
        });

        return toTextResult({
          project: resolvedProject,
          repository,
          count: response.length,
          pullRequests: response.map((pullRequest) => ({
            id: pullRequest.pullRequestId,
            title: pullRequest.title,
            status: pullRequest.status,
            isDraft: pullRequest.isDraft ?? false,
            creationDate: pullRequest.creationDate,
            sourceRefName: pullRequest.sourceRefName,
            targetRefName: pullRequest.targetRefName,
            createdBy: pullRequest.createdBy?.displayName ?? pullRequest.createdBy?.uniqueName,
            reviewers: (pullRequest.reviewers ?? []).map((reviewer) => ({
              name: reviewer.displayName,
              vote: reviewer.vote,
            })),
          })),
        });
      }

      case "ado_get_pull_request": {
        const config = readConfig();
        const repository = asString(args.repository);
        const pullRequestId = asNumber(args.pullRequestId);
        if (!repository) {
          throw new Error("repository är obligatorisk.");
        }

        if (!pullRequestId || pullRequestId < 1) {
          throw new Error("pullRequestId måste vara ett positivt tal.");
        }

        const resolvedProject = ensureProject(asString(args.project), config);
        const pullRequest = await getPullRequest(config, resolvedProject, repository, pullRequestId);

        return toTextResult({
          project: resolvedProject,
          repository,
          pullRequest: mapPullRequest(pullRequest),
        });
      }

      case "ado_list_pull_request_commits": {
        const config = readConfig();
        const repository = asString(args.repository);
        const pullRequestId = asNumber(args.pullRequestId);
        if (!repository) {
          throw new Error("repository är obligatorisk.");
        }

        if (!pullRequestId || pullRequestId < 1) {
          throw new Error("pullRequestId måste vara ett positivt tal.");
        }

        const resolvedProject = ensureProject(asString(args.project), config);
        const response = await adoRequest<CollectionListResponse<PullRequestCommitResponse> | PullRequestCommitResponse[]>(
          config,
          `/${encodePathSegment(resolvedProject)}/_apis/git/repositories/${encodePathSegment(repository)}/pullRequests/${pullRequestId}/commits`,
          undefined,
          {
            "$top": asNumber(args.top) ?? 100,
          },
        );
        const commits = normalizeCollection(response);

        return toTextResult({
          project: resolvedProject,
          repository,
          pullRequestId,
          count: commits.length,
          commits: commits.map((commit) => ({
            commitId: commit.commitId,
            comment: commit.comment,
            author: commit.author,
            committer: commit.committer,
            changeCounts: commit.changeCounts ?? {},
            remoteUrl: commit.remoteUrl,
            url: commit.url,
          })),
        });
      }

      case "ado_get_pull_request_diff": {
        const config = readConfig();
        const repository = asString(args.repository);
        const pullRequestId = asNumber(args.pullRequestId);
        if (!repository) {
          throw new Error("repository är obligatorisk.");
        }

        if (!pullRequestId || pullRequestId < 1) {
          throw new Error("pullRequestId måste vara ett positivt tal.");
        }

        const resolvedProject = ensureProject(asString(args.project), config);
        const diffResult = await getPullRequestDiffResult(config, resolvedProject, repository, pullRequestId, {
          top: asNumber(args.top) ?? 200,
          maxFiles: asNumber(args.maxFiles) ?? 20,
          maxPatchLines: asNumber(args.maxPatchLines) ?? 400,
        });

        return toTextResult({
          project: resolvedProject,
          repository,
          pullRequestId,
          title: diffResult.pullRequest.title,
          sourceCommitId: diffResult.sourceCommitId,
          targetCommitId: diffResult.targetCommitId,
          diffSummary: diffResult.diffSummary,
          includedFileCount: diffResult.files.length,
          files: diffResult.files,
        });
      }

      case "ado_list_pull_request_threads": {
        const config = readConfig();
        const repository = asString(args.repository);
        const pullRequestId = asNumber(args.pullRequestId);
        if (!repository) {
          throw new Error("repository är obligatorisk.");
        }

        if (!pullRequestId || pullRequestId < 1) {
          throw new Error("pullRequestId måste vara ett positivt tal.");
        }

        const resolvedProject = ensureProject(asString(args.project), config);
        const threads = await listPullRequestThreads(config, resolvedProject, repository, pullRequestId);

        return toTextResult({
          project: resolvedProject,
          repository,
          pullRequestId,
          count: threads.length,
          threads: threads.map(mapPullRequestThread),
        });
      }

      case "ado_add_pull_request_comment": {
        const config = readConfig();
        const repository = asString(args.repository);
        const pullRequestId = asNumber(args.pullRequestId);
        const title = asString(args.title) ?? DEFAULT_PR_REVIEW_TITLE;
        const text = asString(args.text);
        if (!repository) {
          throw new Error("repository är obligatorisk.");
        }

        if (!pullRequestId || pullRequestId < 1) {
          throw new Error("pullRequestId måste vara ett positivt tal.");
        }

        if (!text) {
          throw new Error("text är obligatorisk.");
        }

        const resolvedProject = ensureProject(asString(args.project), config);
        const response = await addPullRequestComment(config, resolvedProject, repository, pullRequestId, title, text);

        return toTextResult({
          action: "created",
          project: resolvedProject,
          repository,
          pullRequestId,
          thread: mapPullRequestThread(response),
        });
      }

      case "ado_update_pull_request_comment": {
        const config = readConfig();
        const repository = asString(args.repository);
        const pullRequestId = asNumber(args.pullRequestId);
        const threadId = asNumber(args.threadId);
        const commentId = asNumber(args.commentId);
        const title = asString(args.title) ?? DEFAULT_PR_REVIEW_TITLE;
        const text = asString(args.text);
        if (!repository) {
          throw new Error("repository är obligatorisk.");
        }

        if (!pullRequestId || pullRequestId < 1) {
          throw new Error("pullRequestId måste vara ett positivt tal.");
        }

        if (!threadId || threadId < 1) {
          throw new Error("threadId måste vara ett positivt tal.");
        }

        if (!commentId || commentId < 1) {
          throw new Error("commentId måste vara ett positivt tal.");
        }

        if (!text) {
          throw new Error("text är obligatorisk.");
        }

        const resolvedProject = ensureProject(asString(args.project), config);
        const response = await updatePullRequestComment(
          config,
          resolvedProject,
          repository,
          pullRequestId,
          threadId,
          commentId,
          title,
          text,
        );

        return toTextResult({
          action: "updated",
          project: resolvedProject,
          repository,
          pullRequestId,
          threadId,
          comment: mapPullRequestComment(response),
        });
      }

      case "ado_get_commit_diff": {
        const config = readConfig();
        const repository = asString(args.repository);
        const commitId = asString(args.commitId);
        if (!repository) {
          throw new Error("repository är obligatorisk.");
        }

        if (!commitId) {
          throw new Error("commitId är obligatorisk.");
        }

        const resolvedProject = ensureProject(asString(args.project), config);
        const maxFiles = Math.min(asNumber(args.maxFiles) ?? 20, 100);
        const maxPatchLines = Math.min(asNumber(args.maxPatchLines) ?? 400, 2000);
        const commit = await getCommit(config, resolvedProject, repository, commitId);
        const commitChanges = await getCommitChanges(config, resolvedProject, repository, commitId, asNumber(args.top) ?? 200);
        const parentCommitId = commit.parents?.[0];
        const files = await buildReviewDiffFiles(
          config,
          resolvedProject,
          repository,
          commitChanges.changes ?? commit.changes ?? [],
          parentCommitId,
          commitId,
          maxFiles,
          maxPatchLines,
        );

        return toTextResult({
          project: resolvedProject,
          repository,
          commit: {
            commitId: commit.commitId,
            comment: commit.comment,
            author: commit.author,
            committer: commit.committer,
            parents: commit.parents ?? [],
            remoteUrl: commit.remoteUrl,
            url: commit.url,
            changeCounts: commitChanges.changeCounts ?? commit.changeCounts ?? {},
          },
          files,
        });
      }

      case "ado_query_wiql": {
        const config = readConfig();
        const query = asString(args.query);
        if (!query) {
          throw new Error("query är obligatorisk.");
        }

        const resolvedProject = ensureProject(asString(args.project), config);
        const response = await adoRequest<WiqlResponse>(
          config,
          `/${encodePathSegment(resolvedProject)}/_apis/wit/wiql`,
          {
            method: "POST",
            body: JSON.stringify({ query }),
          },
        );

        return toTextResult({
          project: resolvedProject,
          queryType: response.queryType,
          queryResultType: response.queryResultType,
          asOf: response.asOf,
          columns: (response.columns ?? []).map((column) => ({
            name: column.name,
            referenceName: column.referenceName,
          })),
          workItemIds: (response.workItems ?? []).map((workItem) => workItem.id),
        });
      }

      case "ado_get_work_items": {
        const config = readConfig();
        const ids = asNumberArray(args.ids);
        if (!ids || ids.length === 0) {
          throw new Error("ids måste innehålla minst ett work item-id.");
        }

        const fields = asStringArray(args.fields);
        const expand = asString(args.expand);
        const response = await adoRequest<CollectionListResponse<WorkItemResponse>>(
          config,
          "/_apis/wit/workitems",
          undefined,
          {
            ids: ids.join(","),
            fields: fields?.join(","),
            "$expand": expand,
          },
        );

        return toTextResult({
          count: response.count ?? response.value?.length ?? 0,
          workItems: (response.value ?? []).map((workItem) => mapWorkItem(workItem, expand === "relations" || expand === "all")),
        });
      }

      case "ado_get_work_item_code_links": {
        const config = readConfig();
        const workItemId = asNumber(args.workItemId);
        if (!workItemId || workItemId < 1) {
          throw new Error("workItemId måste vara ett positivt tal.");
        }

        const resolvedProject = ensureProject(asString(args.project), config);
        const workItem = await getWorkItem(config, resolvedProject, workItemId, "relations");
        const relations = workItem.relations ?? [];
        const includeActivePullRequests = args.includeActivePullRequests === true;

        const directCommitLinks = new Map<string, { repositoryId: string; projectId: string; commitId: string; relation: WorkItemRelationResponse }>();
        const pullRequestLinks = new Map<string, { repositoryId: string; projectId: string; pullRequestId: number; relation: WorkItemRelationResponse }>();
        const invalidDirectCommitLinks: Array<{
          relationName: string | undefined;
          repositoryId: string;
          commitId: string;
          reason: string;
        }> = [];

        for (const relation of relations) {
          const parsed = parseGitArtifactUrl(relation.url);
          if (!parsed) {
            continue;
          }

          if (parsed.artifactType === "commit" && parsed.commitId) {
            const normalizedCommitId = normalizeCommitId(parsed.commitId);
            if (!isGitCommitId(normalizedCommitId)) {
              invalidDirectCommitLinks.push({
                relationName: relation.attributes?.name,
                repositoryId: parsed.repositoryId,
                commitId: parsed.commitId,
                reason: "Ogiltigt commit-id i work item-relation.",
              });
              continue;
            }

            directCommitLinks.set(`${parsed.repositoryId}:${normalizedCommitId}`, {
              repositoryId: parsed.repositoryId,
              projectId: parsed.projectId,
              commitId: normalizedCommitId!,
              relation,
            });
          }

          if (parsed.artifactType === "pullRequest") {
            pullRequestLinks.set(`${parsed.repositoryId}:${parsed.pullRequestId}`, {
              repositoryId: parsed.repositoryId,
              projectId: parsed.projectId,
              pullRequestId: parsed.pullRequestId,
              relation,
            });
          }
        }

        const pullRequestResults = await Promise.all(
          [...pullRequestLinks.values()].map(async (link) => {
            const pullRequest = await getPullRequest(config, resolvedProject, link.repositoryId, link.pullRequestId);
            const status = (pullRequest.status ?? "").toLowerCase();
            const include = status === "completed" || (includeActivePullRequests && status === "active");
            const commitsResponse = include
              ? await adoRequest<CollectionListResponse<PullRequestCommitResponse> | PullRequestCommitResponse[]>(
                  config,
                  `/${encodePathSegment(resolvedProject)}/_apis/git/repositories/${encodePathSegment(link.repositoryId)}/pullRequests/${link.pullRequestId}/commits`,
                  undefined,
                  {
                    "$top": 200,
                  },
                )
              : [];
            const commits = normalizeCollection(commitsResponse);
            const reviewCommitIds = include ? collectPullRequestReviewCommitIds(pullRequest, commits) : [];

            return {
              include,
              status,
              relationName: link.relation.attributes?.name,
              repositoryId: link.repositoryId,
              sortTimestamp: getPullRequestSortTimestamp(pullRequest),
              reviewCommitIds,
              deduplicationKeys: include ? getPullRequestDeduplicationKeys(pullRequest, reviewCommitIds) : [],
              pullRequest: mapPullRequest(pullRequest),
              commits: commits.map((commit) => ({
                commitId: commit.commitId,
                comment: commit.comment,
                author: commit.author,
                committer: commit.committer,
                remoteUrl: commit.remoteUrl,
                url: commit.url,
              })),
            };
          }),
        );

        const deduplicationRepresentatives = new Map<string, { pullRequestId: number | undefined; title: string | undefined }>();
        const coveredCommitIds = new Map<string, number[]>();
        const duplicatePullRequests: Array<{
          relationName: string | undefined;
          repositoryId: string;
          pullRequestId: number | undefined;
          title: string | undefined;
          status: string;
          duplicateOfPullRequestId: number | undefined;
          duplicateOfTitle: string | undefined;
          matchedBy: string[];
        }> = [];

        const completedPullRequestResults = pullRequestResults.filter((item) => item.include);
        const optimizedPullRequestResults = completedPullRequestResults
          .sort((left, right) => {
            if (right.sortTimestamp !== left.sortTimestamp) {
              return right.sortTimestamp - left.sortTimestamp;
            }

            return (right.pullRequest.id ?? 0) - (left.pullRequest.id ?? 0);
          })
          .filter((item) => {
            const matchedBy = item.deduplicationKeys.filter((key) => deduplicationRepresentatives.has(key));
            if (matchedBy.length === 0) {
              for (const key of item.deduplicationKeys) {
                deduplicationRepresentatives.set(key, {
                  pullRequestId: item.pullRequest.id,
                  title: item.pullRequest.title,
                });
              }

              for (const commitId of item.reviewCommitIds) {
                const existingPullRequestIds = coveredCommitIds.get(commitId) ?? [];
                coveredCommitIds.set(
                  commitId,
                  item.pullRequest.id ? [...new Set([...existingPullRequestIds, item.pullRequest.id])] : existingPullRequestIds,
                );
              }

              return true;
            }

            const representative = deduplicationRepresentatives.get(matchedBy[0]);
            duplicatePullRequests.push({
              relationName: item.relationName,
              repositoryId: item.repositoryId,
              pullRequestId: item.pullRequest.id,
              title: item.pullRequest.title,
              status: item.status,
              duplicateOfPullRequestId: representative?.pullRequestId,
              duplicateOfTitle: representative?.title,
              matchedBy,
            });
            return false;
          });

        const directCommitLinksToReview = [...directCommitLinks.values()];
        const skippedDirectCommits = directCommitLinksToReview
          .filter((link) => coveredCommitIds.has(link.commitId))
          .map((link) => ({
            relationName: link.relation.attributes?.name,
            repositoryId: link.repositoryId,
            commitId: link.commitId,
            coveredByPullRequestIds: coveredCommitIds.get(link.commitId) ?? [],
            reason: "Commiten täcks redan av en vald pull request.",
          }));

        const directCommitResults = await Promise.all(
          directCommitLinksToReview.filter((link) => !coveredCommitIds.has(link.commitId)).map(async (link) => {
            const commit = await getCommit(config, resolvedProject, link.repositoryId, link.commitId);
            return {
              relationName: link.relation.attributes?.name,
              repositoryId: link.repositoryId,
              commitId: commit.commitId,
              comment: commit.comment,
              author: commit.author,
              committer: commit.committer,
              parents: commit.parents ?? [],
              remoteUrl: commit.remoteUrl,
              url: commit.url,
            };
          }),
        );

        return toTextResult({
          workItem: mapWorkItem(workItem, true),
          optimization: {
            completedPullRequestsBeforeDeduplication: completedPullRequestResults.length,
            completedPullRequestsAfterDeduplication: optimizedPullRequestResults.length,
            duplicatePullRequestsSkipped: duplicatePullRequests.length,
            directCommitsBeforeDeduplication: directCommitLinks.size,
            directCommitsAfterDeduplication: directCommitResults.length,
            directCommitsSkippedBecauseCoveredByPullRequest: skippedDirectCommits.length,
            directCommitsSkippedBecauseInvalidRelation: invalidDirectCommitLinks.length,
          },
          completedPullRequests: optimizedPullRequestResults.map((item) => ({
            relationName: item.relationName,
            repositoryId: item.repositoryId,
            pullRequest: item.pullRequest,
            commits: item.commits,
            reviewCommitIds: item.reviewCommitIds,
          })),
          skippedPullRequests: pullRequestResults.filter((item) => !item.include).map((item) => ({
            relationName: item.relationName,
            repositoryId: item.repositoryId,
            pullRequestId: item.pullRequest.id,
            title: item.pullRequest.title,
            status: item.status,
          })),
          duplicatePullRequests,
          directCommits: directCommitResults,
          skippedDirectCommits: [...skippedDirectCommits, ...invalidDirectCommitLinks],
        });
      }

      case "ado_list_builds": {
        const config = readConfig();
        const resolvedProject = ensureProject(asString(args.project), config);
        const definitionIds = asNumberArray(args.definitionIds);
        const response = await adoRequest<CollectionListResponse<BuildResponse>>(
          config,
          `/${encodePathSegment(resolvedProject)}/_apis/build/builds`,
          undefined,
          {
            "$top": asNumber(args.top) ?? 25,
            branchName: asString(args.branchName),
            statusFilter: asString(args.statusFilter),
            definitions: definitionIds?.join(","),
          },
        );

        return toTextResult({
          project: resolvedProject,
          count: response.count ?? response.value?.length ?? 0,
          builds: (response.value ?? []).map((build) => ({
            id: build.id,
            buildNumber: build.buildNumber,
            status: build.status,
            result: build.result,
            sourceBranch: build.sourceBranch,
            queueTime: build.queueTime,
            startTime: build.startTime,
            finishTime: build.finishTime,
            definition: build.definition?.name,
            requestedFor: build.requestedFor?.displayName,
          })),
        });
      }

      case "ado_list_work_item_comments": {
        const config = readConfig();
        const resolvedProject = ensureProject(undefined, config);
        const workItemId = asNumber(args.workItemId);
        if (!workItemId || workItemId < 1) {
          throw new Error("workItemId måste vara ett positivt tal.");
        }

        const response = await adoRequest<CommentListResponse>(
          config,
          `/${encodePathSegment(resolvedProject)}/_apis/wit/workItems/${workItemId}/comments`,
          undefined,
          {
            "api-version": config.commentsApiVersion,
            "$top": asNumber(args.top) ?? 50,
            includeDeleted: args.includeDeleted === true ? "true" : undefined,
          },
        );

        return toTextResult({
          workItemId,
          totalCount: response.totalCount ?? response.count ?? response.comments?.length ?? 0,
          comments: (response.comments ?? []).map(mapComment),
        });
      }

      case "ado_add_work_item_comment": {
        const config = readConfig();
        const resolvedProject = ensureProject(undefined, config);
        const workItemId = asNumber(args.workItemId);
        if (!workItemId || workItemId < 1) {
          throw new Error("workItemId måste vara ett positivt tal.");
        }

        const title = asString(args.title);
        const text = asString(args.text);
        if (!title || !text) {
          throw new Error("title och text är obligatoriska.");
        }

        const response = await adoRequest<CommentResponse>(
          config,
          `/${encodePathSegment(resolvedProject)}/_apis/wit/workItems/${workItemId}/comments`,
          {
            method: "POST",
            body: JSON.stringify({
              text: formatAiGeneratedComment(title, text),
            }),
          },
          {
            "api-version": config.commentsApiVersion,
          },
        );

        return toTextResult({
          action: "created",
          comment: mapComment(response),
        });
      }

      case "ado_update_work_item_comment": {
        const config = readConfig();
        const resolvedProject = ensureProject(undefined, config);
        const workItemId = asNumber(args.workItemId);
        const commentId = asNumber(args.commentId);
        if (!workItemId || workItemId < 1) {
          throw new Error("workItemId måste vara ett positivt tal.");
        }

        if (!commentId || commentId < 1) {
          throw new Error("commentId måste vara ett positivt tal.");
        }

        const title = asString(args.title);
        const text = asString(args.text);
        if (!title || !text) {
          throw new Error("title och text är obligatoriska.");
        }

        const response = await adoRequest<CommentResponse>(
          config,
          `/${encodePathSegment(resolvedProject)}/_apis/wit/workItems/${workItemId}/comments/${commentId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              text: formatAiGeneratedComment(title, text),
            }),
          },
          {
            "api-version": config.commentsApiVersion,
          },
        );

        return toTextResult({
          action: "updated",
          comment: mapComment(response),
        });
      }

      default:
        throw new Error(`Okänt verktyg: ${request.params.name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function entrypoint() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "auto-review-trigger") {
    await runAutoReviewTrigger(rest);
    return;
  }

  await main();
}

entrypoint().catch((error) => {
  console.error(error);
  process.exit(1);
});
