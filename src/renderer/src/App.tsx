import React, { useState } from 'react'
import { ChatView } from './ChatView'
import { SettingsView } from './SettingsView'
import { EvidenceView } from './EvidenceView'
import type { EvidenceFocus } from './EvidenceView'
import { InspectorView } from './InspectorView'
import { D5View } from './D5View'
import { D6View } from './D6View'
import { TasksView } from './TasksView'

export type View =
  'CHAT' | 'SKELETON' | 'TIMELINE' | 'TASKS' | 'SETTINGS' | 'EVIDENCE' | 'INSPECTOR'

type NavIconName = 'compass' | 'route' | 'calendar' | 'check' | 'evidence' | 'pulse' | 'settings'

const VIEW_META: Record<View, { label: string; title: string; description: string }> = {
  CHAT: {
    label: '规划',
    title: '把复杂旅行拆成可确认的决定',
    description: '约束、路线与研究结论汇入同一次行程。'
  },
  SKELETON: {
    label: '路线骨架',
    title: '先定边界，再填充每天',
    description: '先完成跨城与住宿边界，再安排具体日程。'
  },
  TIMELINE: {
    label: '行程',
    title: '把每一天变成可执行时间轴',
    description: '查看当前版本、缓冲与每一项证据状态。'
  },
  TASKS: {
    label: '待办',
    title: '把出发前风险变成可追踪任务',
    description: '集中处理出发前需要由你完成的事项。'
  },
  SETTINGS: {
    label: '设置',
    title: '本机设置',
    description: '管理来源、模型与不会回显的本机凭据。'
  },
  EVIDENCE: {
    label: '证据',
    title: '可追溯的旅行证据',
    description: '查看事实出处、有效期、冲突与核验状态。'
  },
  INSPECTOR: {
    label: '运行记录',
    title: '只读运行审计',
    description: '检查本地事件、调用结果与降级记录。'
  }
}

const NAV_ITEMS: Array<{ view: View; icon: NavIconName; tier: 'primary' | 'utility' }> = [
  { view: 'CHAT', icon: 'compass', tier: 'primary' },
  { view: 'SKELETON', icon: 'route', tier: 'primary' },
  { view: 'TIMELINE', icon: 'calendar', tier: 'primary' },
  { view: 'TASKS', icon: 'check', tier: 'primary' },
  { view: 'EVIDENCE', icon: 'evidence', tier: 'primary' },
  { view: 'INSPECTOR', icon: 'pulse', tier: 'utility' },
  { view: 'SETTINGS', icon: 'settings', tier: 'utility' }
]

const NAV_ICON_PATHS: Record<NavIconName, string> = {
  compass:
    'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm3.2 5.3-1.5 4.9-4.9 1.5 1.5-4.9 4.9-1.5Z',
  route: 'M5 18V7m0 0 4 4 4-6 6 4m-14 9h14',
  calendar:
    'M6 3.5v3m12-3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  check: 'm5 12 3 3 5-6m1 6h5M5 5h14M5 19h14',
  evidence: 'M7 3.5h7l4 4V20H7V3.5Zm7 0v4h4M9.5 12h6m-6 3h6',
  pulse: 'M4 17h3l2.2-7 3.2 10 2.3-7H20M4 5h16',
  settings:
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2m8.5-8.5h-2m-13 0h-2m14.5-6-1.4 1.4M7.9 16.1l-1.4 1.4m11.5 0-1.4-1.4M7.9 7.9 6.5 6.5'
}

function NavIcon({ name }: { name: NavIconName }): React.JSX.Element {
  return (
    <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
      <path d={NAV_ICON_PATHS[name]} />
    </svg>
  )
}

export function WorkbenchShell({
  view,
  onNavigate,
  children
}: {
  view: View
  onNavigate(view: View): void
  children: React.ReactNode
}): React.JSX.Element {
  const activeMeta = VIEW_META[view]

  return (
    <main className="app-shell route-workbench-shell">
      <a className="skip-link" href="#workspace-content">
        跳到主要内容
      </a>
      <header className="app-header">
        <div className="app-topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32">
                <path d="M7 22.5c3-7 6-2 9-9s5-3 9-7" />
                <circle cx="7" cy="22.5" r="2.2" />
                <circle cx="16" cy="13.5" r="2.2" />
                <circle cx="25" cy="6.5" r="2.2" />
              </svg>
            </span>
            <span className="brand-copy">
              <span>TRAVEL HARNESS</span>
              <strong>行程决策台</strong>
            </span>
          </div>
          <span className="read-only-badge">
            <span aria-hidden="true" className="status-dot" />
            本地优先 · 外部只读
          </span>
        </div>

        <nav aria-label="主导航" className="view-switch">
          {NAV_ITEMS.map((item) => {
            const meta = VIEW_META[item.view]
            return (
              <button
                aria-current={view === item.view ? 'page' : undefined}
                className={`nav-item nav-${item.tier}${view === item.view ? ' active' : ''}`}
                type="button"
                key={item.view}
                onClick={() => onNavigate(item.view)}
              >
                <NavIcon name={item.icon} />
                <span className="nav-label">{meta.label}</span>
              </button>
            )
          })}
        </nav>
      </header>
      <section className="workspace-content" id="workspace-content" tabIndex={-1}>
        {view !== 'CHAT' ? (
          <div className="workspace-heading">
            <p className="eyebrow">行程工作台 · {activeMeta.label}</p>
            <h1>{activeMeta.title}</h1>
            <p className="workspace-description">{activeMeta.description}</p>
          </div>
        ) : (
          <h1 className="visually-hidden">{activeMeta.title}</h1>
        )}
        {children}
      </section>
    </main>
  )
}

function App(): React.JSX.Element {
  const [view, setView] = useState<View>('CHAT')
  const [evidenceFocus, setEvidenceFocus] = useState<EvidenceFocus | null>(null)
  return (
    <WorkbenchShell view={view} onNavigate={setView}>
      {view === 'CHAT' ? (
        <ChatView />
      ) : view === 'SKELETON' ? (
        <D5View />
      ) : view === 'TIMELINE' ? (
        <D6View
          onShowEvidence={(sessionId, claimIds) => {
            setEvidenceFocus({ sessionId, claimIds })
            setView('EVIDENCE')
          }}
        />
      ) : view === 'TASKS' ? (
        <TasksView
          onShowTimeline={() => setView('TIMELINE')}
          onShowEvidence={(sessionId, claimIds) => {
            setEvidenceFocus({ sessionId, claimIds })
            setView('EVIDENCE')
          }}
        />
      ) : view === 'SETTINGS' ? (
        <SettingsView />
      ) : view === 'EVIDENCE' ? (
        <EvidenceView focus={evidenceFocus} />
      ) : (
        <InspectorView />
      )}
    </WorkbenchShell>
  )
}

export default App
