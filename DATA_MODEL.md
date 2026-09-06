# DATA_MODEL

核心数据模型、实体关系、建表 SQL 与关键约束。

实体的**业务语义**见 `PRD:stateModel` 与 `PRD:EC-001`，本文件不复述。这里写的是 PRD 没有的部分：字段类型、主外键、索引、JSONL 行格式、以及几条容易写错的约束。

---

## 1. 双存储模型

```
        写入                          读取
用户确认 ──► events.jsonl ──重放──► SQLite 读模型 ──► 查询/UI
            （事实源）                （派生，可丢弃）
```

- **`events.jsonl` 是唯一权威事实源。** 任何派生状态必须能由它重建（`PRD:eventSourcingRule`）。
- **SQLite 是可丢弃的缓存。** 删掉整个 `.db` 文件后重启，应用必须能从 JSONL 完整重建。这不是灾备特性，是**日常开发手段**——改了读模型结构就删库重建，不要写 UPDATE 脚本去补。
- 两者不一致时以 JSONL 为准。

### 磁盘布局

全部路径由 `src/main/paths.ts` 统一给出，禁止在别处拼路径。根目录固定为 `app.getPath('userData')`（`PRD:NFR-031-c`，asar 只读且 WAL 要求目录可写）。

```
<userData>/
├─ travel-harness.db          SQLite 读模型（+ -wal / -shm）
├─ credentials.json           version 1 凭据容器，只含 safeStorage base64 密文；原子替换写入
├─ provider-config.json       模型路由配置；v1 兼容读取、v2 原子写入，不含凭据
├─ source-config.json         D3 搜索模型等非密钥数据源配置
├─ sessions/
│  └─ <sessionId>/
│     ├─ events.jsonl         该会话的 append-only 事件流
│     └─ snapshot-<seq>.json  周期性快照，加速重建
├─ cache/
│  └─ poi.db                  POI 坐标缓存，跨会话跨项目复用（NFR-030）
└─ logs/
   └─ app-YYYY-MM-DD.jsonl
```

凭据**明文不在**上表中任何位置。safeStorage 只提供加解密能力，不负责持久化；主进程将 version 1 的 base64 密文保存到 `<userData>/credentials.json`（`PRD:NFR-017`）。该文件禁止进入行程导出包、诊断包、日志、SQLite 与 JSONL。

`provider-config.json` version 2 固定包含两个渠道根地址 `DEEPSEEK_OFFICIAL`、`SHUAI_API`，以及 `EXTRACTION / PLANNING / REVIEW / VISION` 四个角色各自的 `channel / model / currency / rate`。渠道根地址只允许 HTTPS origin；API Key 只存在于独立凭据槽。version 1 文件读取时不得迁移或改写，只有用户在 SETTINGS 主动保存后才写入 version 2。

---

## 2. 事件日志

### 行格式

一行一个 JSON 对象，UTF-8，`\n` 结尾，**不允许美化缩进**（会破坏按行解析）。

```json
{"eventId":"evt_01J...","sessionId":"ses_01J...","seq":42,"eventType":"stage/confirmed","actor":"USER","createdAt":"2026-08-21T10:04:11.238Z","payload":{...}}
```

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `eventId` | ULID 字符串 | 全局唯一。用 ULID 不用 UUID，因为它按时间单调递增，排序即时序 |
| `sessionId` | ULID 字符串 | 与所在目录名一致 |
| `seq` | 整数 | **会话内从 1 连续递增，不允许空洞**。重建时 seq 不连续即视为日志损坏 |
| `eventType` | 字符串 | `域/动作`，见 §2.2 |
| `actor` | 枚举 | `USER` / `SYSTEM` / `AGENT:<role>` |
| `createdAt` | ISO 8601 UTC | 带毫秒与 `Z` |
| `payload` | 对象 | 每种 eventType 一个 Zod schema |

### 写入协议

```
append(event):
  1. seq = 当前会话最大 seq + 1        ← 内存计数器，进程内串行
  2. 写一行到 events.jsonl
  3. fsync                             ← 必须。不 fsync 则断电丢的不止最后一条
  4. BEGIN → 更新读模型各表 → COMMIT
  5. emit('event/appended')
```

第 3 步之后、第 4 步之前崩溃是可接受的（重启时重放会补上）。第 2 步写了一半崩溃则最后一行不完整——**重建时遇到无法解析的最后一行应丢弃并告警，遇到中间行无法解析则视为损坏并拒绝启动该会话**。两者处理方式不同，不要写成一个 catch。

### eventType 目录

事件类型独立于 Cordis 事件总线（后者是进程内广播，前者是持久化事实）。**不要混用**。

三组极易写错的近似名，记牢：

| Cordis 事件（ARCHITECTURE §4.2） | 持久化 eventType（本节） |
| --- | --- |
| `event/appended` | —— |
| `evidence/claim-added` | `evidence/added` |
| `gate/blocked` | `gate/result` |
| `session/created` | `session/created` ← **唯一同名项，两者都存在且含义不同** |

tsc 只会对写错的 Cordis 事件名报错，写错 eventType 是运行时静默失效。

| eventType | payload 要点 |
| --- | --- |
| `session/created` | envelope 校验结果、linkedSessionGroup |
| `basics/updated` | 出发地、目的地意向、成员、日期 |
| `envelope/decision` | 超包络时所选方案、被放弃方案、理由（`PRD:FR-107`） |
| `stage/confirmed` | fromStage、toStage、用户确认内容；固定目的地通路可带可选 `confirmation={kind:'FIXED_DESTINATION',city}`，旧事件缺失时仍可回放 |
| `evidence/added` | 完整 EvidenceClaim |
| `evidence/conflicted` | claimId 对 |
| `skeleton/updated` | DaySkeleton 全量 |
| `stay/selected` | 选中候选 + 被放弃候选 |
| `timeline/published` | 完整 TimelineVersion、同次 DecisionLog、source outcomes、verification rollup、changedDates |
| `task/updated` | 完整任务 post-state；用户确认时同事件含 replacement TimelineVersion 与 DecisionLog |
| `gate/result` | 完整 GATE_C 报告、timelineVersion、taskIds、claimIds 与通过/逐项阻塞清单 |
| `decision/logged` | DecisionLog 条目 |
| `destination/candidates-generated` | 2–4 个带 claimIds 的目的地候选 |
| `destination/selected` | 用户选择的 candidateId 与城市 |
| `research/checklist-prepared` | ResearchEntity 派生清单、逐源失败、同事件 `finalClaims`，以及正式人工路径可选的无敏感值 `manualResearchSummary` |
| `research/disposition-set` | 用户对实体选择 MUST_GO / WANT / NEUTRAL / EXCLUDE |
| `research/conflict-resolved` | 用户选定某条 Claim 或明确标记 UNKNOWN |
| `research/confirmed` | D4 研究清单确认时间 |
| `transport/candidates-prepared` | 1–3 个含往返四段、门到门时长和 claimIds 的候选 |
| `transport/candidate-selected` | 用户选择的交通 candidateId |
| `stay/candidates-prepared` | 三来源住宿候选与逐源结果计数 |

### 快照

每 200 条事件、每次 `timeline/published`、用户确认型 `task/updated` 或 `gate/result` 后原子替换一次 `snapshot-v1.json`，内容含 appVersion、sessionId、seq、TravelState 与已校验事件前缀。重建时仅接受与 JSONL 前缀、seq 和状态一致的兼容快照，再重放后续事件；损坏或不兼容快照回退全量 JSONL。快照是**纯优化**——删掉全部快照，应用必须仍能正确重建。

---

## 3. SQLite 读模型

### 通用约定

- 每张表都有 `session_id`，除四张跨会话表：`poi_cache`、`quota_counters`、`blocked_tools`、`source_health`，以及 `schema_migrations`。
- 时间列一律 `TEXT`，存 ISO 8601 UTC 字符串。**不用 INTEGER 时间戳**，因为要直接读日志排查。
- 布尔列用 `INTEGER NOT NULL CHECK (x IN (0,1))`。
- 枚举列用 `TEXT` + `CHECK`，取值与 `shared/schema/` 里的 Zod enum 逐字一致。
- 金额列用 `INTEGER`，单位**分**。禁止 REAL——浮点会让总价对不上。
- 基础表在 `db/migrations/0001_init.sql`；后续仅通过递增迁移添加或演进，D5 交通候选表位于 `0004_d5_transport_candidates.sql`。legacy D6 直接使用 0001 已有的 `timeline_versions`、`timeline_items`、`decision_logs`；D7 由 `0005_d7_task_links.sql` 给 tasks 增加 timeline/item/claim/updated 关联与查询索引；`0006_user_research_source.sql` 增加 `USER_RESEARCH`；`0007_multi_city_routes.sql`、`0008_node_scoped_d4.sql`、`0009_multi_segment_d5.sql` 与 `0010_unified_route_timeline.sql` 依次增加路线拓扑、节点研究、多段 D5 及 unified D6/D7 route scope 投影，旧数据保持不变。

### 建表

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;      -- better-sqlite3 默认关闭，必须显式开
PRAGMA synchronous = NORMAL;   -- WAL 下足够；事实源在 JSONL，这里可放宽

CREATE TABLE sessions (
  session_id            TEXT PRIMARY KEY,
  created_at            TEXT NOT NULL,
  stage                 TEXT NOT NULL CHECK (stage IN
                          ('STAGE_1','STAGE_2','STAGE_3','STAGE_4','STAGE_5','DONE')),
  linked_session_group  TEXT,                       -- ENV-SPLIT 拆会话分组，未拆则 NULL
  split_index           INTEGER,                    -- 组内第几段，从 1 起
  last_seq              INTEGER NOT NULL DEFAULT 0,
  title                 TEXT
);
CREATE INDEX idx_sessions_group ON sessions(linked_session_group)
  WHERE linked_session_group IS NOT NULL;

-- TravelState 整体以 JSON 存单行。理由：它是深层嵌套的派生状态，
-- 查询模式只有"取当前会话全量"，拆表纯属自找麻烦。
CREATE TABLE travel_states (
  session_id  TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,          -- 该状态对应的事件 seq，用于校验是否落后
  state_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE evidence_claims (
  claim_id             TEXT PRIMARY KEY,
  session_id           TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  subject              TEXT NOT NULL,
  predicate            TEXT NOT NULL,
  value_json           TEXT NOT NULL,
  source_id            TEXT NOT NULL CHECK (source_id IN
                         ('SRC_RAIL','SRC_HOTEL','SRC_MAP','SRC_SEARCH','SRC_XHS','USER_PASTE','USER_RESEARCH')),
  source_ref           TEXT NOT NULL,               -- URL 或 工具名+参数摘要，禁止为空
  content_identity     TEXT NOT NULL CHECK (content_identity IN
                         ('OFFICIAL','TRANSACTION','INDEPENDENT_UGC',
                          'COMMERCIAL_OFFER','SUSPECTED_PROMOTION','UNKNOWN')),
  verification_status  TEXT NOT NULL CHECK (verification_status IN
                         ('VERIFIED','CORROBORATED','ESTIMATED','UNVERIFIED',
                          'CONFLICTED','STALE','VERIFIED_BY_USER')),
  observed_at          TEXT NOT NULL,
  valid_until          TEXT NOT NULL,
  confidence           REAL,
  conflicts_with       TEXT,                        -- JSON 数组的 claimId
  notes                TEXT
);
CREATE INDEX idx_claims_session   ON evidence_claims(session_id);
CREATE INDEX idx_claims_subject   ON evidence_claims(session_id, subject);
CREATE INDEX idx_claims_expiry    ON evidence_claims(valid_until);

-- 由 migration 0004 添加；完整候选同时保存在 JSONL/TravelState，SQLite 仅作可查询投影。
CREATE TABLE transport_candidates (
  candidate_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('RAIL','MANUAL_FLIGHT')),
  is_recommended INTEGER NOT NULL CHECK (is_recommended IN (0,1)),
  is_selected INTEGER NOT NULL CHECK (is_selected IN (0,1)),
  total_duration_minutes INTEGER NOT NULL CHECK (total_duration_minutes >= 0),
  total_cost_cents INTEGER CHECK (total_cost_cents >= 0),
  cost_complete INTEGER NOT NULL CHECK (cost_complete IN (0,1)),
  arrival_usable_minutes INTEGER NOT NULL,
  departure_usable_minutes INTEGER NOT NULL,
  comfort TEXT NOT NULL CHECK (comfort IN ('GOOD','FAIR','RISK','UNKNOWN')),
  outbound_json TEXT NOT NULL,
  return_json TEXT NOT NULL,
  claim_ids_json TEXT NOT NULL,
  detail_json TEXT NOT NULL
);
CREATE INDEX idx_transport_candidates_session
  ON transport_candidates(session_id, is_selected, is_recommended);

CREATE TABLE day_skeletons (
  session_id   TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  date         TEXT NOT NULL,                       -- YYYY-MM-DD
  day_type     TEXT NOT NULL CHECK (day_type IN
                 ('ARRIVAL_DAY','NORMAL_DAY','DEPARTURE_DAY',
                  'HOTEL_CHANGE_DAY','INTERCITY_TRANSFER_DAY')),
  intensity    TEXT NOT NULL CHECK (intensity IN ('LOW','MEDIUM','HIGH')),
  morning_json    TEXT, afternoon_json TEXT, evening_json TEXT,
  meal_anchors_json TEXT,
  PRIMARY KEY (session_id, date)
);

CREATE TABLE stay_segments (
  segment_id         TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  area_hint          TEXT,
  check_in_date      TEXT NOT NULL,
  check_out_date     TEXT NOT NULL,
  nights             INTEGER NOT NULL CHECK (nights > 0),
  selected_hotel_ref TEXT
);

CREATE TABLE stay_candidates (
  candidate_id     TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  segment_id       TEXT NOT NULL REFERENCES stay_segments(segment_id) ON DELETE CASCADE,
  source_id        TEXT NOT NULL CHECK (source_id IN
                     ('SRC_HOTEL','SRC_SEARCH','USER_PASTE')),  -- 三来源地位平等，见 FR-501
  name             TEXT NOT NULL,
  total_cost_cents INTEGER,                         -- 覆盖全部住宿夜的可比较总成本
  free_cancel_until TEXT,
  room_fits_party  INTEGER CHECK (room_fits_party IN (0,1)),
  detail_json      TEXT NOT NULL,
  claim_id         TEXT REFERENCES evidence_claims(claim_id)
);
CREATE INDEX idx_stay_cand ON stay_candidates(session_id, segment_id);

CREATE TABLE timeline_versions (
  session_id  TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  summary     TEXT NOT NULL,
  is_current  INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  PRIMARY KEY (session_id, version)
);
-- 每会话至多一个 current 版本
CREATE UNIQUE INDEX idx_timeline_current
  ON timeline_versions(session_id) WHERE is_current = 1;

CREATE TABLE timeline_items (
  item_id       TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  version       INTEGER NOT NULL,
  date          TEXT NOT NULL,
  start_time    TEXT NOT NULL,                      -- HH:MM，本地时区
  end_time      TEXT NOT NULL,
  title         TEXT NOT NULL,
  item_class    TEXT NOT NULL CHECK (item_class IN
                  ('FIXED','RECOMMENDED','FLEXIBLE','OPTIONAL','BACKUP')),
  anchor_class  TEXT NOT NULL CHECK (anchor_class IN
                  ('HARD_LOCKED','CONFIRMED_EXTERNAL','MUST','PREFERRED','FLEXIBLE')),
  location_json TEXT,
  transport_json TEXT,                              -- 到达本项目的交通方式与 ETA
  buffer_minutes INTEGER NOT NULL DEFAULT 0,        -- 必须可见，不允许隐式吸收
  cost_cents    INTEGER,
  claim_ids     TEXT,                               -- JSON 数组
  FOREIGN KEY (session_id, version)
    REFERENCES timeline_versions(session_id, version) ON DELETE CASCADE
);
CREATE INDEX idx_items_day ON timeline_items(session_id, version, date, start_time);

CREATE TABLE tasks (
  task_id       TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('PREPARATION','RESERVATION_TICKET')),
  title         TEXT NOT NULL,
  owner         TEXT,
  due_at        TEXT,
  recheck_at    TEXT,
  priority      TEXT NOT NULL CHECK (priority IN ('HIGH','NORMAL','LOW')),
  user_decision TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (user_decision IN ('PENDING','ACCEPTED','SKIPPED')),
  reservation   TEXT NOT NULL DEFAULT 'NOT_STARTED'
                  CHECK (reservation IN ('NOT_STARTED','IN_PROGRESS','DONE','FAILED')),
  readiness     TEXT NOT NULL DEFAULT 'UNKNOWN'
                  CHECK (readiness IN ('UNKNOWN','READY','BLOCKED')),
  -- 以下四轴 M0 不实现，字段存在但恒为默认值（PRD:tierRule）
  payment       TEXT NOT NULL DEFAULT 'NA',
  document      TEXT NOT NULL DEFAULT 'NA',
  refund        TEXT NOT NULL DEFAULT 'NA',
  reminder      TEXT NOT NULL DEFAULT 'NA',
  handover_json TEXT
);

-- 由 migration 0005 添加；旧数据库先保留 NULL，首次任务派生完成关联。
ALTER TABLE tasks ADD COLUMN timeline_version INTEGER;
ALTER TABLE tasks ADD COLUMN item_id TEXT;
ALTER TABLE tasks ADD COLUMN claim_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN updated_at TEXT;
CREATE INDEX idx_tasks_item_kind
  ON tasks(session_id, timeline_version, item_id, kind);
CREATE INDEX idx_tasks_due
  ON tasks(session_id, priority, due_at, recheck_at);

CREATE TABLE decision_logs (
  decision_id     TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  topic           TEXT NOT NULL,
  chosen_json     TEXT NOT NULL,
  rejected_json   TEXT NOT NULL,                    -- 被放弃的方案，禁止为空数组时省略
  rationale       TEXT NOT NULL,
  claim_ids       TEXT
);

CREATE TABLE model_calls (
  call_id      TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('EXTRACTION','PLANNING','REVIEW','VISION')),
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  tokens_in    INTEGER NOT NULL,
  tokens_out   INTEGER NOT NULL,
  cost_cents   INTEGER NOT NULL,
  latency_ms   INTEGER NOT NULL,
  ok           INTEGER NOT NULL CHECK (ok IN (0,1)),
  created_at   TEXT NOT NULL,
  cost_status  TEXT NOT NULL DEFAULT 'UNKNOWN'
               CHECK (cost_status IN ('ESTIMATED','UNKNOWN')),
  cost_currency TEXT,
  input_rate_minor_per_million INTEGER,
  output_rate_minor_per_million INTEGER
);
CREATE INDEX idx_model_calls_session ON model_calls(session_id, created_at);
CREATE INDEX idx_model_calls_provider_currency
  ON model_calls(provider, cost_currency, created_at);
-- 注意：model_calls / tool_calls / blocked_tools / source_health 的 session_id
-- 刻意不加外键，也不参与 CASCADE。它们是审计与可观测记录，
-- 必须在会话重建甚至删除后继续存在（blocked_tools 是 AC-M0-08 的验收依据）。

CREATE TABLE tool_calls (
  call_id     TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  args_digest TEXT NOT NULL,                        -- 摘要，不是原文；见下方约束
  duration_ms INTEGER NOT NULL,
  ok          INTEGER NOT NULL CHECK (ok IN (0,1)),
  error_code  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_tool_calls_session ON tool_calls(session_id, created_at);

-- 被拒绝注册的工具，供 Inspector 展示（AC-M0-08）
CREATE TABLE blocked_tools (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE source_health (
  source_id    TEXT PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('OK','DEGRADED','UNCONFIGURED')),
  last_ok_at   TEXT,
  last_error   TEXT,
  fail_streak  INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

`model_calls.provider` 记录**实际传输与计费渠道**，不是根据模型名推断的品牌。v2 新调用只会写 `DEEPSEEK_OFFICIAL` 或 `SHUAI_API`；经帅 API 调用名为 `gpt-*`、`gemini-*` 或 `deepseek-*` 的模型仍写 `SHUAI_API`。version 1 兼容调用继续保留原 `OPENAI / DEEPSEEK / GEMINI` 值。表中只保存模型名、token、费率快照、成本、耗时和成功状态，不保存 API Key、Authorization、Prompt、响应正文或供应商错误正文。

### POI 缓存（独立库）

放 `cache/poi.db`，**不放主库**。理由：它跨会话跨项目复用，且删主库重建时它必须活下来——否则每次重建都会重新烧掉高德的 5000 次月配额（`PRD:NFR-030`）。

```sql
CREATE TABLE poi_cache (
  cache_key   TEXT PRIMARY KEY,        -- normalize(名称) + '|' + city
  name        TEXT NOT NULL,
  city        TEXT NOT NULL,
  lng         REAL NOT NULL,
  lat         REAL NOT NULL,
  detail_json TEXT,
  fetched_at  TEXT NOT NULL
);

CREATE TABLE quota_counters (
  bucket      TEXT NOT NULL,           -- 'AMAP_SEARCH' / 'AMAP_LBS' / 'AMAP_WEATHER'
  month       TEXT NOT NULL,           -- YYYY-MM
  used        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, month)
);
```

POI 缓存**永不过期**——坐标不会变。详情（`detail_json`）按 30 天过期。配额计数按自然月分桶，跨月自动归零。

D4 不新增实体归并表。`TravelState.state_json` 以加法字段保存 `destinationCandidates`、`selectedDestinationCandidateId`、`researchEntities`、`researchChecklistConfirmed`、`conflictResolutions`、`sourceResearchFailures` 与可空 `manualResearchSummary`，它们都必须能由上表事件重建。人工 summary 只含 mode、计数与 confirmedAt，不含来源名称、URL、摘要或硬锚值。`fixedDestinationCity` 只存在于 Renderer 使用的 D4 snapshot，由 STAGE-2 的唯一 basics 城市规范化派生，不是 `TravelState` 持久字段。固定目的地确认保持 `destinationCandidates=[]`、`selectedDestinationCandidateId=null`，城市来自 basics 与可选 stage confirmation，不伪造 `destination/selected`。

---

## 4. 几条容易写错的约束

**`source_ref` 禁止为空。** 没有 `sourceRef` 的 EvidenceClaim 一律视为模型臆测（`PRD:hallucinationRule`）。这条要在 Zod schema、SQL `NOT NULL` 和写入函数三处都拦——只靠 NOT NULL 会让你在运行时才发现，而那时提示词已经跑完了。

**`SRC_XHS` 不持久化访问令牌。** 小红书 Claim 的 `source_ref` 只能是 `https://www.xiaohongshu.com/explore/{feedId}` 形式的 canonical URL，禁止 query、hash、userinfo。搜索返回的 `xsec_token` 仅在同一 ToolRegistry 操作内短暂传给详情工具；`value_json`、`source_ref`、`args_digest`、JSONL、日志与 Renderer 都不得包含它。`value_json.queryKind` 只能取 `POSITIVE_LOCATION` / `NEGATIVE_AVOIDANCE`，表示查询来源而非情感事实。

**`USER_PASTE` 与 `USER_RESEARCH` 不得混同。** 原始粘贴仍以独立 `evidence/added` 事件保存为 `USER_PASTE / UNVERIFIED`，不会自动进入研究抽取或被升级。正式人工清单可以可选关联同 session 的 USER_PASTE claim，也可直接创建；逐项确认后才在一个 `research/checklist-prepared` 事件的 `finalClaims` 中写入 `USER_RESEARCH / VERIFIED_BY_USER`。其 `source_ref` 固定为 `USER_RESEARCH:<digest>`，不得包含来源名称、URL、摘要或硬锚值；硬锚 Claim 的 `observed_at=checkedAt`，24 小时后为 `STALE`。

**route-node provenance 不可互换。** 默认 XHS_STRICT 路径产生的 Claim 必须保持 `SRC_XHS / INDEPENDENT_UGC` 及其 `UNVERIFIED` 或跨独立证据得出的 `CORROBORATED` 状态；多条 UGC 一致不能直接产生硬事实 `VERIFIED`。开放时间、闭园和预约硬锚需关联另一份独立 allowlisted 标准/官方来源 Claim，否则保持 UNKNOWN/BLOCKED。人工降级另写 `USER_RESEARCH / VERIFIED_BY_USER`，不得把 XHS Claim 改写成人工来源，也不得把既有人工 Claim 回填成 MCP 已验证。

**实体归并是派生投影，不是改写证据。** `evidence_claims.subject` 保留该条事实抽取时所描述的对象；D3 直接查询或 `USER_PASTE` 线索尤其不得伪装成已经确认的规范实体。D4 只在同一已选目的地、同一实体类别且有确定身份依据或严格结构化解析时，用 `ResearchEntity.canonicalSubject`、`aliases` 与 `claimIds` 把多个称呼归并；不同类别或无依据的同名对象保持分开并标为 `AMBIGUOUS`。只有 SKILL-04 已完成来源绑定与目的地校验的最终事实才应直接写规范化 `subject`；去重逻辑不得删除、覆盖或合并原始 Claim 行。

**ResearchEntity 仍是读模型。** 推广唯一支撑、成员适配、有效期汇总和未解决冲突等字段从 EvidenceClaim 纯计算后随 `research/checklist-prepared` 写入事件。用户的 disposition 与冲突裁决另写持久化事件并进入 DecisionLog；系统自动算出的体力风险不是用户决策，不写 DecisionLog。

**`args_digest` 是摘要不是原文。** 工具参数可能含地址等信息，且 Inspector 面板是给人看的。存 `工具名 + 参数键列表 + 关键值的短哈希`，不要 `JSON.stringify(args)`。这属本地落库脱敏（`PRD:NFR-028`、`PRIVACY-001`），与出站最小化（`PRD:NFR-022`）是两件事，两处都要做。

**金额单位是分，整数。** `total_cost_cents`、`cost_cents`。任何地方出现 `price: 328.5` 都是 bug。

**`valid_until` 由 `observed_at` + validityWindow 计算，写入时算好存下来**，不要在查询时动态算。因为 window 规则将来会调整，而已存的 Claim 的有效期不应该被追溯修改。

**过期不是删除。** 超过 `valid_until` 的 Claim 转为 `STALE`（`PRD:expiryRule`），行仍在表里。STALE 的 Claim 不得支撑 GATE_C 通过，也不得作为新推荐的唯一依据，但它在 Inspector 里必须仍然可见——否则"这个数据当时是哪来的"就断了。

**`is_current` 的唯一索引带 `WHERE is_current = 1`。** 切换当前版本必须在一个事务里先清后置，否则会撞唯一约束。

**外键要显式开。** better-sqlite3 默认 `foreign_keys = OFF`，不开的话上面所有 `REFERENCES` 都只是注释。

**拆会话的组内一致性由应用层保证。** `linked_session_group` 只是一个分组标记，SQLite 不校验组内 `split_index` 是否连续。创建子会话时一次性建完并在同一事务写入（`PRD:AC-M0-34`）。

---

## 5. 从 JSONL 重建

`TravelStateService.rebuild(sessionId)` 的契约：

```
1. 清空该 session 在**读模型**表中的行（外键 CASCADE 会带走大部分）。
   **不清空** `model_calls` / `tool_calls` / `blocked_tools` / `source_health`——
   它们是审计记录，无对应 eventType，清掉就永久丢失且无法从 JSONL 还原。
2. 载入最新 snapshot-<seq>.json，若无则从空状态起
3. 顺序重放 seq > snapshot.seq 的事件
4. 校验：最终 seq 必须等于 events.jsonl 的最后一行 seq
5. 写回 travel_states.seq
```

第 4 步的校验必须有。缺了它，一个中途 return 的 reducer 会让状态静默停在半路，而 UI 看起来完全正常。

重放必须是**纯函数式的**：`apply(state, event) => state`，不允许在 reducer 里发起 IO、调模型或写日志。否则重建一次会把外部调用全部重放一遍，直接烧掉配额。

---

## 10. D4 30 帖研究事件扩展（PRD:FR-309）

`research/checklist-prepared` 仍是 eventVersion=2 的加法事件。旧 payload `entities + sourceFailures` 原样可读；新字段均可选：

- `xhsSampleSummary`：目的地、15/15、4 search、30 detail、6 EXTRACTION、1 REVIEW、retry=0、loadAllComments=false。
- `attractionRankings[]`：rank、entityId、subject、`3R−4A+fit` 分解、family fit、推荐/避雷证据、claimIds 与固定 `UNVERIFIED`。
- `finalClaims[]`：经七次严格模型处理后物化的 XHS 信号 Claim。
- `manualResearchSummary`：正式人工路径的 mode=`USER_CONFIRMED`、itemCount、linkedPasteCount 与 confirmedAt；不得包含来源名称、URL、摘要或硬锚值。

自动 XHS 与正式人工两条通路都把 `finalClaims` 与 checklist 放在同一个 JSONL 事件里；`TravelStateService.writeState` 在一个 SQLite transaction 中同时 upsert evidence_claims 与更新 session 投影。这样模型或完整人工校验成功后不会出现“final Claims 已写入但 checklist 缺失”的中间态。重放该事件只做纯函数投影与本地 SQL，不连接来源、不调用模型。

来源正文 Claim 仍各自通过 `evidence/added` 留存，`value_json` 只含 query、sampleGroup、title、author、noteType、截断正文与 enriched；不含 xsec_token、评论、Authorization、raw response 或模型 prompt。此次为事件 payload 加法，无 SQLite schema 变化。

---

## 11. migration 0008：节点化 D4 投影

`0008_node_scoped_d4.sql` 新增 route-node research state、entity、Claim link、conflict 与 outcome 投影，并为 `evidence_claims` 增加独立 scope 关联。所有节点记录以 `session_id + route_id + node_id` 为所有权边界；同一短实体名或 Claim 内容可在不同节点产生不同确定性 ID，不允许跨节点复用身份。

五类 V2 节点事件覆盖 checklist、disposition、conflict、confirmed 与 USER_PASTE。Reducer 先校验事件 scope 与所有嵌套 summary/entity/Claim scope 一致，再更新内存状态；SQLite 在同一事务投影节点状态和关联行。最终 required 节点的 confirmed 事件同时携带 STAGE-3→STAGE-4，避免第二个 stage 事件造成中间态。

兼容规则是双读而非历史回写：旧 JSONL 无 scope 时按旧单目的地语义读取；运行在 migration 0001–0007 fixture 上时，repository 不要求不存在的 scope/节点表。新数据库必须完成 0008 并开启 foreign keys，重建不得连接来源或调用模型。

---

## 12. migration 0009：多段 route-D5 投影

`0009_multi_segment_d5.sql` 新增 `route_d5_leg_states/options/anchors`、`route_d5_stay_states/candidates/outcomes`、`route_d5_day_skeletons` 与 `route_d5_confirmations`。所有行都以 0007 的 `session_id + route_id` 拓扑为根，并把 `leg_id` 或 `node_id + segment_id` 纳入主键/外键；单城市 `transport_candidates/day_skeletons/stay_candidates` 不迁移也不回写。

七类 `route-d5/*` eventVersion=2 事件是唯一写入入口。leg/stay prepared payload 中的 `finalClaims` 与对应状态在同一个 `TravelStateService.record` 事务投影，避免 Claim 已存在而目标段仍未准备的中间态。`route-d5/confirmed` 是多城市 D5 唯一 STAGE-4→STAGE-5 事件。

`route_d5_day_skeletons` 每个 `session_id + route_id + date` 只有一行；`route_leg_ids_json` 保存同日多段跨城腿的稳定顺序，`route_leg_id` 保留首腿兼容引用。局部 patch 的 `changedDates` 只能包含目标日，并只清除 owning segment 的候选/选择；删除 SQLite 后从旧 JSONL 与新增 V2 事件重建时不得连接 Rail/Map/Hotel 或模型。

---

## 13. migration 0010：unified D6/D7 route scope 投影

`0010_unified_route_timeline.sql` 给 `timeline_versions` 增加 nullable `route_id`，给 `timeline_items` 与 `tasks` 增加 nullable route/node/segment/leg 标量列及 `route_context_json`，并建立 session+route、node、segment、leg 查询索引。它不创建第二套时间轴或任务事实表；legacy 行及旧事件回放时所有新增列保持 null。

## 14. Route core 人工交通证据：无 migration 0011

`EvidenceScope` 现在是加法 union：既有 D4 节点 Claim 使用 `ROUTE_NODE { routeId, nodeId }`；STAGE-2 人工交通 Claim 使用 `ROUTE_GOAL_LEG { fromCity, toCity, travelDate }`。后者固定为 `source_id='USER_RESEARCH'`、`predicate='routeLeg'`、`verification_status='VERIFIED_BY_USER'`、`confidence=null`，`value_json` 保存方式、带 offset 的起止时刻、Main 派生时长/跨夜/零换乘、可选费用、来源名、安全 HTTPS URL 与摘要。

本能力不增加 migration 0011。权威 `itinerary/route-manual-evidence-applied` V2 事件在一个 payload 中保存 Claim、goal-leg scope 与重算后的 candidates/blockers；`evidence_claims.value_json`、路线 `detail_json` 和 JSONL 已足以无损承载。既有 node-only SQLite scope 关联表只投影 `ROUTE_NODE`；读取 goal-leg Claim 时由 `SourceRepository` 从已校验 `value_json` 恢复 scope。删除 SQLite 后按 migrations 0001–0010 重放，必须恢复相同 Claim、candidates、blockers 与 selected state，且不得改写历史事件字节或调用来源/模型。

多城市 `timeline/published`、`task/updated` 与 `gate/result` 的完整 payload 仍是唯一事实。`TravelStateService` 在原事件事务中写 route scope；读取 JSON 时必须使用 shared schema 复核，不从展示地点或标题反推身份。删除 SQLite 后从未改写 JSONL 重建必须恢复等价 route context，且不得创建 pending plan、连接来源或调用模型。
