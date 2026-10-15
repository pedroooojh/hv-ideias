import { supabase } from './supabase';
import { toApiError } from './errors';
import type { ProjectStatus, SortOrder, SuggestionStatus } from './domain';

// Tipos que espelham o retorno das funções RPC (supabase/migrations/*_api.sql).
// Contagens bigint chegam como número pelo PostgREST.

export interface Profile {
  id: string;
  name: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  created_at: string;
}

export interface SuggestionType {
  slug: string;
  label: string;
  sort_order: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  category: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  suggestion_count: number;
  vote_count: number;
}

export interface ProjectListItem extends Project {
  last_activity_at: string;
  total_count: number;
}

export interface ProjectDetail extends Project {
  type_counts: Record<string, number>;
  status_counts: Record<string, number>;
}

export interface PlatformStats {
  active_projects: number;
  total_suggestions: number;
  total_votes: number;
  in_development: number;
  votes_last_24h: number;
  votes_last_7d: number;
  top_projects: Array<{ id: string; name: string; category: string; vote_count: number; share: number }>;
  highlight: null | {
    suggestion_id: string;
    title: string;
    status: SuggestionStatus;
    project_name: string;
    vote_count: number;
    changed_at: string;
  };
}

export interface SuggestionListItem {
  id: string;
  project_id: string;
  type: string;
  type_label: string;
  title: string;
  description: string;
  status: SuggestionStatus;
  status_reason: string | null;
  author_name: string;
  is_author: boolean;
  created_at: string;
  updated_at: string;
  vote_count: number;
  comment_count: number;
  has_voted: boolean;
  voting_open: boolean;
  total_count: number;
}

export interface SuggestionDetail extends Omit<SuggestionListItem, 'total_count'> {
  project_name: string;
  project_category: string;
  status_changed_at: string | null;
  can_edit: boolean;
  can_delete: boolean;
}

export interface StatusHistoryEntry {
  id: number;
  previous_status: SuggestionStatus | null;
  new_status: SuggestionStatus;
  reason: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface CommentItem {
  id: string;
  content: string | null;
  author_name: string | null;
  is_author: boolean;
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  deletion_reason: 'author' | 'moderation' | null;
  can_edit: boolean;
  can_delete: boolean;
  total_count: number;
}

export interface RankingEntry {
  rank_position: number;
  user_name: string;
  score: number;
  suggestion_count: number;
  votes_received: number;
  is_me: boolean;
  total_count: number;
}

export interface MyScore {
  rank_position: number | null;
  score: number;
  suggestion_count: number;
  votes_received: number;
}

export interface MySuggestion {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  status: SuggestionStatus;
  created_at: string;
  vote_count: number;
  points: number;
  total_count: number;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  created_at: string;
  suggestion_count: number;
  total_count: number;
}

export interface AdminSuggestion {
  id: string;
  project_id: string;
  project_name: string;
  type: string;
  type_label: string;
  title: string;
  status: SuggestionStatus;
  author_name: string;
  created_at: string;
  vote_count: number;
  comment_count: number;
  total_count: number;
}

export interface AuditEntry {
  id: number;
  actor_name: string | null;
  entity_type: 'project' | 'suggestion' | 'comment' | 'user';
  entity_id: string | null;
  entity_label: string | null;
  action: string;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
  total_count: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  nextOffset: number | null;
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  let result;
  try {
    result = await supabase.rpc(fn, args);
  } catch (err) {
    throw toApiError(err);
  }
  if (result.error) throw toApiError(result.error);
  return result.data as T;
}

async function rpcRows<T>(fn: string, args?: Record<string, unknown>): Promise<T[]> {
  return (await rpc<T[] | null>(fn, args)) ?? [];
}

async function rpcSingle<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const rows = await rpcRows<T>(fn, args);
  if (rows.length === 0) throw toApiError({ code: 'HV404', message: 'Registro não encontrado.' });
  return rows[0];
}

function toPage<T extends { total_count: number }>(rows: T[], offset: number, limit: number): Page<T> {
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const next = offset + rows.length;
  return { items: rows, total, nextOffset: rows.length === limit && next < total ? next : null };
}

export const PAGE_SIZE = 20;

export const api = {
  // Perfil -------------------------------------------------------------------
  getMyProfile: () => rpcRows<Profile>('get_my_profile').then((rows) => rows[0] ?? null),
  updateMyProfile: (name: string) => rpc<void>('update_my_profile', { p_name: name }),
  getMyScore: () => rpcSingle<MyScore>('get_my_score'),
  listMySuggestions: async (filters: { status: SuggestionStatus | null }, offset = 0, limit = PAGE_SIZE) =>
    toPage(
      await rpcRows<MySuggestion>('list_my_suggestions', { p_limit: limit, p_offset: offset, p_status: filters.status }),
      offset,
      limit,
    ),

  // Plataforma ---------------------------------------------------------------
  getPlatformStats: () => rpc<PlatformStats>('get_platform_stats'),
  listSuggestionTypes: () => rpcRows<SuggestionType>('list_suggestion_types'),

  // Projetos -----------------------------------------------------------------
  listProjects: async (
    filters: { search?: string | null; status?: ProjectStatus | null } = {},
    offset = 0,
    limit = 12,
  ) =>
    toPage(
      await rpcRows<ProjectListItem>('list_projects', {
        p_limit: limit,
        p_offset: offset,
        p_search: filters.search || null,
        p_status: filters.status ?? null,
      }),
      offset,
      limit,
    ),
  projectStatusCounts: (search: string | null) =>
    rpc<Record<string, number>>('project_status_counts', { p_search: search || null }),
  getProject: (id: string) => rpcSingle<ProjectDetail>('get_project', { p_id: id }),
  createProject: (input: ProjectInput) =>
    rpc<string>('create_project', {
      p_name: input.name,
      p_description: input.description,
      p_category: input.category,
      p_status: input.status,
    }),
  updateProject: (id: string, input: ProjectInput) =>
    rpc<void>('update_project', {
      p_id: id,
      p_name: input.name,
      p_description: input.description,
      p_category: input.category,
      p_status: input.status,
    }),
  deleteProject: (id: string, confirmWithSuggestions: boolean) =>
    rpc<void>('delete_project', { p_id: id, p_confirm_with_suggestions: confirmWithSuggestions }),

  // Sugestões ----------------------------------------------------------------
  listSuggestions: async (params: {
    projectId: string;
    type: string | null;
    status: SuggestionStatus | null;
    search: string | null;
    sort: SortOrder;
    offset?: number;
  }) => {
    const offset = params.offset ?? 0;
    const rows = await rpcRows<SuggestionListItem>('list_suggestions', {
      p_project_id: params.projectId,
      p_type: params.type,
      p_status: params.status,
      p_search: params.search || null,
      p_sort: params.sort,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    return toPage(rows, offset, PAGE_SIZE);
  },
  getSuggestion: (id: string) => rpcSingle<SuggestionDetail>('get_suggestion', { p_id: id }),
  listStatusHistory: (id: string) => rpcRows<StatusHistoryEntry>('list_status_history', { p_suggestion_id: id }),
  createSuggestion: (projectId: string, input: SuggestionInput) =>
    rpc<string>('create_suggestion', {
      p_project_id: projectId,
      p_type: input.type,
      p_title: input.title,
      p_description: input.description,
    }),
  updateSuggestion: (id: string, input: SuggestionInput) =>
    rpc<void>('update_suggestion', {
      p_id: id,
      p_type: input.type,
      p_title: input.title,
      p_description: input.description,
    }),
  deleteSuggestion: (id: string) => rpc<void>('delete_suggestion', { p_id: id }),
  setSuggestionStatus: (id: string, status: SuggestionStatus, reason: string | null) =>
    rpc<void>('set_suggestion_status', { p_id: id, p_status: status, p_reason: reason }),

  // Votos --------------------------------------------------------------------
  setVote: (suggestionId: string, vote: boolean) =>
    rpcSingle<{ vote_count: number; has_voted: boolean }>('set_vote', {
      p_suggestion_id: suggestionId,
      p_vote: vote,
    }),

  // Comentários --------------------------------------------------------------
  listComments: async (suggestionId: string, offset = 0, limit = 50) =>
    toPage(
      await rpcRows<CommentItem>('list_comments', { p_suggestion_id: suggestionId, p_limit: limit, p_offset: offset }),
      offset,
      limit,
    ),
  createComment: (suggestionId: string, content: string) =>
    rpc<string>('create_comment', { p_suggestion_id: suggestionId, p_content: content }),
  updateComment: (id: string, content: string) => rpc<void>('update_comment', { p_id: id, p_content: content }),
  deleteComment: (id: string) => rpc<void>('delete_comment', { p_id: id }),

  // Ranking ------------------------------------------------------------------
  getRanking: async (offset = 0, limit = 50) =>
    toPage(await rpcRows<RankingEntry>('get_ranking', { p_limit: limit, p_offset: offset }), offset, limit),

  // Administração ------------------------------------------------------------
  adminListSuggestions: async (
    filters: { status: SuggestionStatus | null; type: string | null; search: string | null },
    offset = 0,
    limit = PAGE_SIZE,
  ) =>
    toPage(
      await rpcRows<AdminSuggestion>('admin_list_suggestions', {
        p_status: filters.status,
        p_type: filters.type,
        p_search: filters.search || null,
        p_limit: limit,
        p_offset: offset,
      }),
      offset,
      limit,
    ),
  adminSuggestionStatusCounts: (filters: { type: string | null; search: string | null }) =>
    rpc<Record<string, number>>('admin_suggestion_status_counts', {
      p_type: filters.type,
      p_search: filters.search || null,
    }),
  adminListUsers: async (
    filters: { search: string | null; role: AdminUser['role'] | null; status: AdminUser['status'] | null },
    offset = 0,
    limit = 50,
  ) =>
    toPage(
      await rpcRows<AdminUser>('admin_list_users', {
        p_search: filters.search || null,
        p_role: filters.role,
        p_status: filters.status,
        p_limit: limit,
        p_offset: offset,
      }),
      offset,
      limit,
    ),
  adminUserStatusCounts: (filters: { search: string | null; role: AdminUser['role'] | null }) =>
    rpc<Record<string, number>>('admin_user_status_counts', { p_search: filters.search || null, p_role: filters.role }),
  adminUpdateUser: (userId: string, role: AdminUser['role'], status: AdminUser['status']) =>
    rpc<void>('admin_update_user', { p_user_id: userId, p_role: role, p_status: status }),
  adminListAuditLog: async (entityType: string | null, offset = 0, limit = 50) =>
    toPage(
      await rpcRows<AuditEntry>('admin_list_audit_log', {
        p_entity_type: entityType,
        p_limit: limit,
        p_offset: offset,
      }),
      offset,
      limit,
    ),
};

export interface ProjectInput {
  name: string;
  description: string;
  category: string;
  status: ProjectStatus;
}

export interface SuggestionInput {
  type: string;
  title: string;
  description: string;
}

/** Chaves do React Query, centralizadas para invalidação consistente. */
export const qk = {
  profile: (userId: string | undefined) => ['profile', userId] as const,
  stats: ['stats'] as const,
  types: ['suggestion-types'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  suggestions: (projectId: string) => ['suggestions', projectId] as const,
  suggestion: (id: string) => ['suggestion', id] as const,
  statusHistory: (id: string) => ['status-history', id] as const,
  comments: (suggestionId: string) => ['comments', suggestionId] as const,
  ranking: ['ranking'] as const,
  myScore: ['my-score'] as const,
  mySuggestions: ['my-suggestions'] as const,
  adminUsers: ['admin-users'] as const,
  adminSuggestions: ['admin-suggestions'] as const,
  auditLog: ['audit-log'] as const,
};
