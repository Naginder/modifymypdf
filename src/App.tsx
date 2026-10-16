import { useState } from 'react';
import { Images } from './tools/Images';
import { Compress } from './tools/Compress';
import { Merge } from './tools/Merge';
import { Organize } from './tools/Organize';
import { tabId } from './lib/model';

const tools = [
  { title: 'Images to PDF', component: Images },
  { title: 'Compress PDF', component: Compress },
  { title: 'Merge PDFs', component: Merge },
  { title: 'Organize Pages', component: Organize },
];

export function App() {
  const [active, setActive] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hasFiles, setHasFiles] = useState(false);
  const Tool = tools[active].component;
  const switchTool = (index: number) => {
    if (index === active || busy) return false;
    if (hasFiles && !window.confirm('Changing tools clears the current files, results, and edits. Continue?')) return false;
    setHasFiles(false); setActive(index); setGeneration((value) => value + 1);
    return true;
  };
  return <main>
    <header><div><h1>PDF Tools</h1><p>Simple tools. Your files stay in your browser.</p></div>
      <button onClick={() => {
        setGeneration((value) => value + 1); setHasFiles(false); setBusy(false);
      }}>Clear files</button>
    </header>
    <nav role="tablist" aria-label="PDF tools">{tools.map((tool, index) => <button key={tool.title}
      role="tab" id={tabId(tool.title)} aria-controls="tool-panel" aria-selected={active === index}
      tabIndex={active === index ? 0 : -1} disabled={busy}
      onClick={() => switchTool(index)} onKeyDown={(event) => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tools.length
          : event.key === 'ArrowLeft' ? (index + tools.length - 1) % tools.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? tools.length - 1 : undefined;
        if (next !== undefined) {
          event.preventDefault();
          if (switchTool(next)) document.getElementById(tabId(tools[next].title))?.focus();
        }
      }}>{tool.title}</button>)}</nav>
    <Tool key={`${active}-${generation}`} onBusy={setBusy} onFiles={setHasFiles} />
  </main>;
}
