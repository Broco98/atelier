function App() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-[300px] shrink-0 flex-col border-r bg-sidebar">
        {/* traffic lights row — drag region, buttons live at inset (12, 20) */}
        <div data-tauri-drag-region className="h-[52px] shrink-0" />
        <div className="flex-1" />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header data-tauri-drag-region className="h-[52px] shrink-0" />
        <div className="flex-1" />
      </main>
    </div>
  );
}

export default App;
