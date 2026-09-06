# Windows 安装与 Outlook 人工验收表

> 状态：Windows 安装器候选已就绪，所有人工步骤尚未执行；Outlook 验收必须等当前云南 session 完成 D4→D5→D6/D7 并产生正式 ICS 后再进行。本文档不授权代理执行安装、卸载或 Outlook 导入。

## 当前 Windows 候选身份

- 文件：`dist/travel-harness-1.0.0-setup.exe`
- 字节数：`104973007`
- LastWriteTimeUtc：`2026-09-03T10:57:09.9822222Z`
- SHA-256：`90559FAED71636808A64FFC3E78BA14F40680FEFB0E5CAC757725A8BAFFB0350`
- Authenticode：`NotSigned`（无 signer）
- 已知表现：可能出现 SmartScreen / 未签名提示；必须记录真实显示，不得写成“已签名”。

## A. Windows 用户人工验收

### A1. 安装

- [ ] 用户本人选择并运行上述精确安装器。
- [ ] 记录 SmartScreen / 未签名提示是否出现及其大致表现（不粘贴任何私密路径或凭据）。
- [ ] 安装完成，程序文件存在。
- [ ] 桌面快捷方式存在。
- [ ] 开始菜单快捷方式存在。

用户记录：

### A2. 首次启动

- [ ] 应用能启动并显示主界面。
- [ ] 不显示凭据原文、完整工具参数或原始来源响应。
- [ ] 用户可看到或打开当前任务；如未恢复，记录现象而不自动修改 userData。

用户记录：

### A3. 再次启动与恢复

- [ ] 正常关闭应用。
- [ ] 再次启动后，当前 session 及已完成状态正确恢复。
- [ ] 没有重放任何已消费的 Gate，也没有自动来源/模型调用。

用户记录：

### A4. 卸载

- [ ] 用户本人执行卸载。
- [ ] 程序文件消失。
- [ ] 桌面与开始菜单快捷方式消失。
- [ ] 无 Travel Harness 运行进程。
- [ ] userData 保留情况被单独记录。当前 `deleteAppDataOnUninstall=false` 的预期是保留；保留不应误判为卸载器缺陷。

用户记录：

## B. Outlook ICS 用户人工验收

### B0. 前置（当前未满足）

- [ ] Session `01M1BRR11EFXB64KMRSEQ2GTP9` 已完成所有 required D4 node。
- [ ] Route-D5 的 5 个 leg 与 3 个 stay 已通过对应 Gate 且确认。
- [ ] 已存在该 route 的 current published TimelineVersion、route-scoped tasks 与 GATE_C。
- [ ] 正式产品已导出 `travel-01M1BRR11EFXB64KMRSEQ2GTP9-v<version>.ics` 及同版本 Markdown。
- [ ] 已记录 ICS 的绝对路径、版本、字节数和 SHA-256，且通过导出秘密扫描。

当前权威状态：`STAGE_3`，TimelineVersion / timeline items / route-scoped tasks / GATE_C / route-D5 confirmation 均为 0，所以现在不得宣称 Outlook 可验收。

### B1. 导入与核对（待 B0 完成后由用户执行）

- [ ] 用户本人将上述精确 ICS 导入 Outlook。
- [ ] 导入后的日期覆盖 `2026-09-08` 至 `2026-09-17`，且与 current TimelineVersion 逐项一致。
- [ ] 时刻正确显示为 Asia/Shanghai 当地时间。当前权威 ICS 合同使用等值 UTC `Z`，不要以“必须出现字面 `TZID`”误判。
- [ ] 所有非 `BACKUP` 事件有正确结束时刻，跨夜事件在 Outlook 中正确落到次日。
- [ ] 每日零时长 `BACKUP` 可见且没有伪造持续时长（原始 VEVENT 只有 `DTSTART`，无 `DTEND`）。
- [ ] 路线顺序、必去点、跨城/入住/退房标记与 Markdown 和 TimelineVersion 一致。
- [ ] 导入内容不含凭据、原始 Evidence、完整工具参数、PNR/证件号或精确私人地址。

用户记录：

## 通过口径

- Windows 与 Outlook 是两组独立的 USER-MANUAL 证据，未执行的步骤一律不得标记为 PASS。
- 只有 A1–A4 和 B0–B1 均完成，且 LIVE E2E 也无阻断缺陷，NEXT-017 才可关闭。
