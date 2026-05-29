import fs from 'fs'

const src = fs.readFileSync('src/components/agent/zjt/DramaZjtWorkspace.tsx', 'utf8')
let out = src
  .replace(/DramaZjtSideRail/g, 'DramaAgentSideNav')
  .replace(/DramaZjtWorkspace/g, 'DramaAgentWorkspace')
  .replace(/drama-zjt/g, 'drama-agent')
  .replace(/zjt-section/g, 'drama-section')
  .replace(
    '智剧通式右侧工作区：点阵画布 + 剧本大卡 + 角色/分镜列表（图一图二）。',
    '短剧 Agent 右侧工作区：点阵底 + 竖向导航 + 剧本大卡',
  )
  .replace(
    "import { DramaAgentSideNav } from './DramaAgentSideNav'",
    "import { DramaAgentSideNav, type DramaNavTab } from './DramaAgentSideNav'",
  )

out = out.replace(
  /const \[tab, setTab\] = useState<DramaRailTab>\(\(\) => getDramaWorkspaceTab\(\)\)/,
  "const [navTab, setNavTab] = useState<DramaNavTab>('overview')",
)
out = out.replace(
  /useEffect\(\(\) => subscribeDramaWorkspaceTab\(\(\) => setTab\(getDramaWorkspaceTab\(\)\)\), \[\]\)/,
  'useEffect(() => subscribeDramaWorkspaceTab(() => setNavTab(getDramaWorkspaceTab())), [])',
)
out = out.replace(
  /const scrollToSection = useCallback\(\(next: DramaRailTab\) => \{\s*setTab\(next\)\s*setDramaWorkspaceTab\(next\)/,
  `const onNavChange = useCallback((next: DramaNavTab) => {
    setNavTab(next)
    if (next === 'overview') {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const railTab = next as DramaRailTab
    setDramaWorkspaceTab(railTab)`,
)
out = out.replace(
  /const el = sectionRefs\.current\[next\]/,
  'const el = sectionRefs.current[railTab]',
)
out = out.replace(
  /activeTab=\{tab\} onTabChange=\{scrollToSection\} onScrollHome=\{scrollHome\} \/>/,
  'activeTab={navTab} onTabChange={onNavChange} />',
)
out = out.replace(/  const scrollHome = useCallback\([\s\S]*?\}, \[\]\)\n\n  /, '  ')
out = out.replace(
  /      <div className="drama-agent-workspace__main">\n        <header className="drama-agent-workspace__top">[\s\S]*?<\/header>\n\n        /,
  '      <div className="drama-agent-workspace__main">\n        ',
)

fs.writeFileSync('src/components/agent/drama/DramaAgentWorkspace.tsx', out, 'utf8')
console.log('written')
