import { useState } from 'react';
import { ArrowUpRight, Bike, Bluetooth, ChevronRight, Mountain, Play, ShieldCheck, Timer } from 'lucide-react';
import RoadScene from './scene/RoadScene';
import Profile from './ui/Profile';
import { presets, totalSeconds } from './workouts/model';
export default function App() {
  const [selected, setSelected] = useState(presets[0]);
  const [filter, setFilter] = useState('All workouts');
  return <div className="app-shell">
    <header className="topbar"><a href="/" className="brand"><Bike size={29} /><span>BIKE<span>SIM</span></span></a><nav><button className="active">Workouts</button></nav><div className="top-status"><ShieldCheck size={15} /> Local & private <span className="separator" /><Bluetooth size={16} /> Trainer offline</div></header>
    <main className="library"><div className="page-heading"><div><div className="eyebrow">YOUR TRAINING, YOUR PACE</div><h1>Find your next ride.</h1><p>A focused workout. An open road. Just you.</p></div><span className="pill"><span className="status-dot" /> Demo ready</span></div>
    <section className="feature"><div className="feature-copy"><span className="eyebrow">A ROAD OF YOUR OWN</span><h2>Somewhere<br />worth pedaling.</h2><p>Structured training in the foothills.<br />Start with a workout below.</p><div className="feature-foot"><Mountain size={19} /><div>Oaxaca foothills<span>Procedural landscape · Offline</span></div><ArrowUpRight size={20} /></div></div><div className="feature-scene"><RoadScene speed={8} /><span className="scene-tag">OAXACA, MÉXICO · INSPIRED LANDSCAPE</span></div></section>
    <div className="section-title"><h2>Choose your effort</h2><span>{presets.length} workouts · made for your own rhythm</span></div>
    <div className="filters">{['All workouts', 'Endurance', 'Sweet spot', 'Hills', 'Recovery'].map(f => <button key={f} className={f === filter ? 'selected' : ''} onClick={() => setFilter(f)}>{f}</button>)}</div>
    <div className="workout-layout"><div className="workout-grid">{presets.filter(w => filter === 'All workouts' || w.category === filter).map(w => <button key={w.id} className={`workout-card ${selected.id === w.id ? 'chosen' : ''}`} onClick={() => setSelected(w)}><div className="card-top"><span className="eyebrow">{w.category}</span><ArrowUpRight size={17} /></div><h3>{w.name}</h3><Profile workout={w} /><div className="card-meta"><span><Timer size={15} /> {Math.round(totalSeconds(w) / 60)} min</span><span>ERG workout</span></div></button>)}</div><aside className="workout-detail"><span className="eyebrow">TODAY'S RIDE</span><h2>{selected.name}</h2><p>{selected.description}</p><Profile workout={selected} large /><div className="detail-stats"><span><strong>{Math.round(totalSeconds(selected) / 60)}</strong> minutes</span><span><strong>{selected.blocks.length}</strong> intervals</span></div><button className="primary" onClick={() => setSelected(presets.find(w => w.id === 'quick')!)}><Play size={18} /> Preview a short workout <ChevronRight size={17} /></button><p className="fine-print">Demo preview · No trainer commands</p></aside></div>
    </main><footer>BIKESIM <span>Built for the ride. Kept on your computer.</span><span>Oaxaca, MX</span></footer>
  </div>;
}
