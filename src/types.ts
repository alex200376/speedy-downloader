export type TaskStatus =
  | "Pending"
  | "Queued"
  | "Downloading"
  | "Paused"
  | "Completed"
  | "Error"
  | "Canceled";

export interface GrabRequest {
  id: string;
  url: string;
  filename: string;
  save_dir: string;
  referer: string | null;
  kind?: "http" | "video";
}

export interface SegmentState {
  index: number;
  start: number;
  end: number;
  written: number;
}

export interface DownloadTask {
  id: string;
  url: string;
  filename: string;
  save_dir: string;
  file_path: string;
  total_size: number | null;
  downloaded: number;
  segments: number;
  status: TaskStatus;
  speed: number;
  referer: string | null;
  headers: Record<string, string>;
  created_at: number;
  finished_at: number | null;
  error: string | null;
  supports_ranges: boolean;
  filename_from_user: boolean;
  segment_states: SegmentState[];
  kind?: "http" | "video";
  quality?: string | null;
  write_subs?: boolean;
  sub_lang?: string | null;
}

export interface Settings {
  save_dir: string;
  max_concurrent: number;
  default_segments: number;
  speed_limit_kbps: number;
  language: string;
  theme: string;
  accent: string;
  duplicate_policy: string;
  sort_by_type: boolean;
  notify_complete: boolean;
  open_folder_on_complete: boolean;
  proxy: string;
  api_port: number;
}

export type DuplicatePolicy = "rename" | "overwrite" | "skip";

export interface VerifyHashResult {
  hash: string;
  algorithm: string;
  matched: boolean | null;
  filename: string;
}

export type FilterKey = "all" | "downloading" | "completed" | "paused" | "error";

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
}

export interface HealthInfo {
  name: string;
  version: string;
  online: boolean;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  has_update: boolean;
  title: string;
  notes: string;
  asset_name: string;
  asset_url: string;
  asset_size: number;
  release_url: string;
}

export interface PlaylistVideo {
  url: string;
  title: string;
  duration: number | null;
  id: string | null;
}