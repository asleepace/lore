/** Shared shapes. Every command's `--json` output is built from these, so tools can be piped. */

export type Kind = 'INV' | 'DEC' | 'NOTE';
export type Level = 'error' | 'warn' | 'info';
export type Severity = 'high' | 'medium' | 'low';
export type Tier = 'tested' | 'anchored' | 'asserted';

export interface Issue {
  code: string;
  level: Level;
  /** `node`, `node#PREFIX-n`, or `path:line`. */
  where: string;
  message: string;
}

export interface Claim {
  /** Full reference, uppercase claim part: `room#INV-2`. */
  ref: string;
  node: string;
  /** `INV-2`. */
  id: string;
  /** The prefix as written: `INV`, `LIM`, … */
  prefix: string;
  kind: Kind;
  /** The first paragraph: the claim itself. */
  statement: string;
  /** Paragraphs after the first. */
  rationale: string[];
  meta: Record<string, string>;
  active: boolean;
  /** 1-based lines of the claim's heading and its last line in the node file. */
  line: number;
  endLine: number;
}

export interface LoreNode {
  id: string;
  /** Repository-relative path. */
  path: string;
  folder: string;
  title: string;
  lead: string;
  frontmatter: Record<string, unknown>;
  claims: Claim[];
  /** `## ` headings that aren't claim sections. */
  openSections: string[];
  /** Parent in the map's tree (`lore` for top level). */
  parent: string;
  /** Position in the map (reading order); nodes not in the map sort last, by ID. */
  order: number;
  lines: number;
}

export interface Marker {
  file: string;
  line: number;
  /** Last line of the region it anchors. */
  endLine: number;
  ref: string;
  /** `upholds` for `@lore <ref>` (and v0.2's `enforces`/`implements`), `see` for `@lore see`. */
  verb: 'upholds' | 'see';
}

export interface Graph {
  root: string;
  /** `lore` field of LORE.md, or `0.1` for an APP.md graph. */
  version: string;
  folders: string[];
  publicFolders: string[];
  gate: 'off' | 'warn' | 'block';
  nodes: Map<string, LoreNode>;
  claims: Map<string, Claim>;
  markers: Marker[];
  issues: Issue[];
}

/** The record that flows between commands (`select | ask`, …). */
export interface ClaimRecord {
  ref: string;
  kind: Kind;
  statement: string;
  severity?: Severity;
  reasons?: string[];
  question?: string;
}
