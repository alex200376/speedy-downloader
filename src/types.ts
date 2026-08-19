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
  created_at: number;
  finished_at: number | null;
  error: string | null;
  supports_ranges: boolean;
  filename_from_user: boolean;
  segment_states: SegmentState[];
}

export interface Settings {
  save_dir: string;
  max_concurrent: number;
  default_segments: number;
  speed_limit_kbps: number;
  language: string;
  theme: string;
  accent: string;
  api_port: number;
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