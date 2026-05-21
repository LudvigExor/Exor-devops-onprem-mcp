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
import { promisify } from "node:util";

type ServerConfig = {
  baseUrl: string;
  apiVersion: string;
  commentsApiVersion: string;
  defaultProject?: string;
  authHeader?: string;
  authMode: "header" | "pat" | "basic" | "windows" | "anonymous";
  useDefaultCredentials: boolean;
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
  remoteUrl?: string;
  url?: string;
  changeCounts?: Record<string, number>;
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
  url?: string;
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
      },
      required: ["ids"],
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

  return `<p><i>AI-genererad kommentar:</i></p><p><strong>${escapeHtml(trimmedTitle)}</strong></p>${formatTextBodyAsHtml(trimmedText)}`;
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

function readConfig(): ServerConfig {
  const auth = resolveAuth(process.env);
  const baseUrl = process.env.ADO_BASE_URL?.trim();

  if (!baseUrl) {
    throw new Error("ADO_BASE_URL saknas. Ange collection-URL till Azure DevOps Server.");
  }

  const apiVersion = process.env.ADO_API_VERSION?.trim() || DEFAULT_API_VERSION;

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiVersion,
    commentsApiVersion: process.env.ADO_COMMENTS_API_VERSION?.trim() || `${apiVersion}-preview.3`,
    defaultProject: process.env.ADO_DEFAULT_PROJECT?.trim() || undefined,
    authHeader: auth.authHeader,
    authMode: auth.authMode,
    useDefaultCredentials: auth.authMode === "windows",
  };
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

async function main() {
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
        const response = await adoRequest<CollectionListResponse<PullRequestResponse>>(
          config,
          `/${encodePathSegment(resolvedProject)}/_apis/git/repositories/${encodePathSegment(repository)}/pullrequests`,
          undefined,
          {
            "searchCriteria.status": asString(args.status) ?? "active",
            "$top": asNumber(args.top) ?? 25,
          },
        );

        return toTextResult({
          project: resolvedProject,
          repository,
          count: response.count ?? response.value?.length ?? 0,
          pullRequests: (response.value ?? []).map((pullRequest) => ({
            id: pullRequest.pullRequestId,
            title: pullRequest.title,
            status: pullRequest.status,
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
        const maxFiles = Math.min(asNumber(args.maxFiles) ?? 20, 100);
        const maxPatchLines = Math.min(asNumber(args.maxPatchLines) ?? 400, 2000);
        const pullRequest = await getPullRequest(config, resolvedProject, repository, pullRequestId);
        const sourceCommitId = pullRequest.lastMergeSourceCommit?.commitId;
        const targetCommitId = pullRequest.lastMergeTargetCommit?.commitId;

        if (!sourceCommitId || !targetCommitId) {
          throw new Error("Pull request saknar commit-information för diff. lastMergeSourceCommit och lastMergeTargetCommit krävs.");
        }

        const diffResponse = await adoRequest<GitCommitDiffsResponse>(
          config,
          `/${encodePathSegment(resolvedProject)}/_apis/git/repositories/${encodePathSegment(repository)}/diffs/commits`,
          undefined,
          {
            "$top": asNumber(args.top) ?? 200,
            diffCommonCommit: "false",
            baseVersion: targetCommitId,
            baseVersionType: "commit",
            targetVersion: sourceCommitId,
            targetVersionType: "commit",
          },
        );

        const candidateChanges = (diffResponse.changes ?? []).filter((change) => !change.item?.isFolder).slice(0, maxFiles);
        const files = await Promise.all(
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

            const shouldReadOld = !changeType.includes("add");
            const shouldReadNew = !changeType.includes("delete");

            const [oldItem, newItem] = await Promise.all([
              shouldReadOld && originalPath
                ? getGitItemAtCommit(config, resolvedProject, repository, originalPath, targetCommitId)
                : Promise.resolve(undefined),
              shouldReadNew && currentPath
                ? getGitItemAtCommit(config, resolvedProject, repository, currentPath, sourceCommitId)
                : Promise.resolve(undefined),
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
              targetCommitId,
              sourceCommitId,
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

        return toTextResult({
          project: resolvedProject,
          repository,
          pullRequestId,
          title: pullRequest.title,
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
        const response = await adoRequest<CollectionListResponse<PullRequestThreadResponse> | PullRequestThreadResponse[]>(
          config,
          `/${encodePathSegment(resolvedProject)}/_apis/git/repositories/${encodePathSegment(repository)}/pullRequests/${pullRequestId}/threads`,
        );
        const threads = normalizeCollection(response);

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
        const response = await adoRequest<PullRequestThreadResponse>(
          config,
          `/${encodePathSegment(resolvedProject)}/_apis/git/repositories/${encodePathSegment(repository)}/pullRequests/${pullRequestId}/threads`,
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

        return toTextResult({
          action: "created",
          project: resolvedProject,
          repository,
          pullRequestId,
          thread: mapPullRequestThread(response),
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
        const response = await adoRequest<CollectionListResponse<WorkItemResponse>>(
          config,
          "/_apis/wit/workitems",
          undefined,
          {
            ids: ids.join(","),
            fields: fields?.join(","),
          },
        );

        return toTextResult({
          count: response.count ?? response.value?.length ?? 0,
          workItems: (response.value ?? []).map((workItem) => ({
            id: workItem.id,
            rev: workItem.rev,
            url: workItem.url,
            fields: workItem.fields ?? {},
          })),
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
