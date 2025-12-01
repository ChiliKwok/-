import React, { useState, useEffect, useRef } from 'react';
import { SectId,  GameState, GamePhase, SectState, InteractionState,  Point, LocationData} from './types';
import { SECTS, GOAL_PROGRESS, SECT_ORDER, WEATHERS, FIXED_LOCATIONS } from './constants';
import * as GeminiService from './services/geminiService';

// --- Helper Functions (Outside Component) ---
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

const getDistance = (p1: Point, p2: Point) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
const getPathLength = (path: Point[]) => { if (path.length < 2) return 0; let total = 0; for (let i = 0; i < path.length - 1; i++) total += getDistance(path[i], path[i+1]); return total; };
const getPathPosition = (progressVal: number, path: Point[] | undefined): { left: string, top: string } => {
    const percentage = Math.min(100, Math.max(0, (progressVal / GOAL_PROGRESS) * 100));
    if (!path || path.length < 2) return { left: `${percentage}%`, top: '50%' };
    const totalLen = getPathLength(path);
    if (totalLen === 0) return { left: `${path[0].x}%`, top: `${path[0].y}%` };
    const targetDist = (percentage / 100) * totalLen;
    let currentDist = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i]; const p2 = path[i+1]; const segDist = getDistance(p1, p2);
        if (currentDist + segDist >= targetDist) { const ratio = (targetDist - currentDist) / segDist; return { left: `${p1.x + (p2.x - p1.x) * ratio}%`, top: `${p1.y + (p2.y - p1.y) * ratio}%` }; }
        currentDist += segDist;
    }
    const last = path[path.length - 1]; return { left: `${last.x}%`, top: `${last.y}%` };
};

// --- UI Components ---
const Button: React.FC<{ 
  onClick: () => void; 
  children: React.ReactNode; 
  disabled?: boolean; 
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; 
  className?: string; 
  icon?: React.ReactNode; 
  style?: React.CSSProperties; 
}> = ({ onClick, children, disabled, variant = 'primary', className = '', icon, style }) => {
  const baseStyle = "relative px-6 py-2 font-serif font-bold transition-all duration-300 overflow-hidden border select-none flex items-center justify-center gap-2 tracking-widest shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none";
  const variants = { 
    primary: "text-stone-950 bg-gradient-to-b from-[#e6c88b] to-[#c5a059] border-[#8a6a28] hover:brightness-110 hover:shadow-[0_0_15px_rgba(197,160,89,0.4)] active:scale-95", 
    secondary: "text-[#c5a059] bg-stone-900/80 border-[#c5a059] hover:bg-[#c5a059]/10 active:scale-95", 
    danger: "text-white bg-gradient-to-b from-[#a31f1f] to-[#7a1515] border-[#5c0e0e] hover:brightness-110 active:scale-95", 
    ghost: "text-stone-400 border-transparent hover:text-[#c5a059] hover:bg-stone-800/50" 
  };
  return <button onClick={onClick} disabled={disabled} style={style} className={`${baseStyle} ${variants[variant]} ${className}`}>{icon}{children}</button>;
};

const StatInput: React.FC<{ 
  label: string; 
  value: number; 
  onChange: (val: number) => void; 
  color?: string; 
}> = ({ label, value, onChange, color = "text-stone-300" }) => (
  <div className="flex justify-between items-center border-b border-stone-800/50 pb-1">
      <span className="text-stone-500 text-sm">{label}</span>
      <input 
        type="number" 
        value={value} 
        onChange={(e) => onChange(parseInt(e.target.value) || 0)} 
        className={`bg-transparent text-right font-mono w-16 focus:outline-none focus:border-b focus:border-gold ${color}`} 
      />
  </div>
);

// --- Main App Component ---
const App: React.FC = () => {
  const [phase, setPhase] = useState<GamePhase>(GamePhase.INTRO);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Customization State
  const [tempMapBg, setTempMapBg] = useState<string | null>(null);
  const [tempPath, setTempPath] = useState<Point[]>([]);
  const [isDrawingPath, setIsDrawingPath] = useState<boolean>(false);
  const [tempSectImages, setTempSectImages] = useState<Record<string, string>>({});
  const [tempSectPortraits, setTempSectPortraits] = useState<Record<string, string>>({});
  const [uploadingSectId, setUploadingSectId] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<'TOKEN' | 'PORTRAIT' | null>(null);

  // Interaction State
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  const [interactionValue, setInteractionValue] = useState<string>("5");
  const [interactionStats, setInteractionStats] = useState({ martial: 0, strategy: 0, wealth: 0, prestige: 0 });
  const [applySkipTurn, setApplySkipTurn] = useState<boolean>(false);
  const [applyActionAgain, setApplyActionAgain] = useState<boolean>(false);
  const [manualLogText, setManualLogText] = useState<string>("");

  const [viewingSectDetail, setViewingSectDetail] = useState<SectId | null>(null);
  const [dmInputValue, setDmInputValue] = useState<string>("5");
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);
  const sectImageInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Game State
  const [gameState, setGameState] = useState<GameState>({
    day: 1, weather: WEATHERS[0], activeSectIndex: 0, turnQueue: SECT_ORDER, isDayComplete: false,
    sectStates: {} as Record<SectId, SectState>, globalLog: []
  });

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [gameState.globalLog]);

  // Logic
  const startSetup = () => setPhase(GamePhase.SETUP);
  const getRandomWeather = () => WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
  const getLocationData = (progress: number): LocationData => FIXED_LOCATIONS[Math.min(GOAL_PROGRESS, Math.max(0, Math.floor(progress)))] || FIXED_LOCATIONS[0];

  const initializeGame = () => {
    const startLoc = getLocationData(0);
    const initialSects: any = {};
    SECT_ORDER.forEach(id => {
        initialSects[id] = {
            id, locationProgress: 0, currentLocationName: startLoc.name,
            stats: { martial: 20, strategy: 20, wealth: 20, prestige: 0 },
            history: [], visitedLocations: [startLoc.name], lastMoveDesc: '蓄势待发', skipNextTurn: false,
        };
    });
    setGameState(prev => ({
        ...prev, day: 1, weather: getRandomWeather(), activeSectIndex: 0, turnQueue: SECT_ORDER, isDayComplete: false,
        sectStates: initialSects, globalLog: [{ day: 1, type: 'system', content: '七曜同宫，逆鳞现世。七大门派整装待发。' }],
        customMapBg: tempMapBg || undefined, customPath: tempPath.length > 1 ? tempPath : undefined,
        customSectImages: tempSectImages, customSectPortraits: tempSectPortraits
    }));
    setPhase(GamePhase.MAIN_LOOP); setInteraction(null);
  };

  const handleMapUploadClick = () => mapInputRef.current?.click();
  const handleMapFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if(file) { const b64 = await fileToBase64(file); phase===GamePhase.SETUP ? setTempMapBg(b64) : setGameState(p => ({...p, customMapBg: b64})); } event.target.value=''; };
  const handleSectImageClick = (id: string, type: 'TOKEN'|'PORTRAIT') => { setUploadingSectId(id); setUploadingType(type); setTimeout(()=>sectImageInputRef.current?.click(),0); };
  const handleSectImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if(f && uploadingSectId && uploadingType) { const b = await fileToBase64(f); if(uploadingType==='TOKEN') setTempSectImages(p=>({...p, [uploadingSectId]: b})); else setTempSectPortraits(p=>({...p, [uploadingSectId]: b})); } e.target.value=''; setUploadingSectId(null); setUploadingType(null); };
  const handleStatEdit = (id: SectId, k: any, v: number) => setGameState(p => ({...p, sectStates: {...p.sectStates, [id]: {...p.sectStates[id], stats: {...p.sectStates[id].stats, [k]: v}}}}));
  const handleSaveGame = () => { const b = new Blob([JSON.stringify(gameState)],{type:"application/json"}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href=u; a.download="save.json"; a.click(); };
  const handleLoadGameClick = () => fileInputRef.current?.click();
  const handleFileChange = (e: any) => { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload=(ev)=>{ try { setGameState(JSON.parse(ev.target?.result as string)); alert("读取成功！"); } catch(err) { alert("存档错误"); } }; r.readAsText(f); e.target.value = ''; };
  const handleSetupMapClick = (e: any) => { if(isDrawingPath) { const r = e.currentTarget.getBoundingClientRect(); setTempPath(p=>[...p, {x: ((e.clientX-r.left)/r.width)*100, y: ((e.clientY-r.top)/r.height)*100}]); } };

  // --- Core Logic ---

  const localizeText = (text: string, sectId: SectId) => {
      const sectName = SECTS[sectId].name;
      return text.replace(/你/g, sectName).replace(/Your/g, sectName);
  };

  const formatStatChanges = (stats?: { martial?: number, strategy?: number, wealth?: number, prestige?: number }) => {
      if (!stats) return "";
      const parts = [];
      if (stats.martial) parts.push(`武力${stats.martial > 0 ? '+' : ''}${stats.martial}`);
      if (stats.strategy) parts.push(`智谋${stats.strategy > 0 ? '+' : ''}${stats.strategy}`);
      if (stats.wealth) parts.push(`财富${stats.wealth > 0 ? '+' : ''}${stats.wealth}`);
      if (stats.prestige) parts.push(`威望${stats.prestige > 0 ? '+' : ''}${stats.prestige}`);
      return parts.length > 0 ? ` ${parts.join(' ')}` : "";
  };

  const resolveCollisions = async (moverId: SectId, targetProgress: number, depth = 0): Promise<void> => {
      const occupierId = Object.keys(gameState.sectStates).find(key => {
          if (key === moverId) return false;
          const s = gameState.sectStates[key as SectId];
          return Math.floor(s.locationProgress) === Math.floor(targetProgress) && targetProgress > 0 && targetProgress < 120;
      });

      if (occupierId && depth < 5) {
          const locationName = getLocationData(targetProgress).name;
          const desc = await GeminiService.generateConflictNarrative(moverId, occupierId, locationName, gameState.weather);
          setInteraction({
              type: 'PVP', activeSectId: moverId, targetSectId: occupierId as SectId,
              locationName: locationName, description: desc, pendingProgress: targetProgress
          });
          setInteractionValue("3");
          setManualLogText(desc);
          return;
      }

      const locationData = getLocationData(targetProgress);
      const eventData = await GeminiService.generateOpportunityEvent(gameState.sectStates[moverId], locationData, gameState.weather);
      
      setInteractionStats({ martial: 0, strategy: 0, wealth: 0, prestige: 0 });
      setInteractionValue("0");
      setApplySkipTurn(false);
      setApplyActionAgain(false);
      setManualLogText(eventData.title);

      setInteraction({
          type: 'OPPORTUNITY', activeSectId: moverId, locationName: locationData.name,
          description: eventData.description, pendingProgress: targetProgress, eventData: eventData.eventData
      });
  };

  const handleTurnStart = async () => {
    if (loading) return;
    const activeSectId = gameState.turnQueue[gameState.activeSectIndex];
    const activeState = gameState.sectStates[activeSectId];

const handleTurnStart = async () => {
    if (loading) return;
    const activeSectId = gameState.turnQueue[gameState.activeSectIndex];
    const activeState = gameState.sectStates[activeSectId];

      // --- 修改开始：强制跳过逻辑 ---
    // 只要处于滞留状态，无视输入步数，直接执行跳过逻辑
    if (activeState.skipNextTurn) {
        setGameState(prev => {
            // 1. 计算下一个轮次（逻辑与 commitTurn 保持一致）
            let nextIndex = prev.activeSectIndex + 1;
            let nextDay = prev.day;
            let nextWeather = prev.weather;
            let dayComplete = false;

            // 如果超过队列长度，进入下一天
            if (nextIndex >= prev.turnQueue.length) {
                nextIndex = 0;
                nextDay += 1;
                dayComplete = true;
                nextWeather = getRandomWeather(); // 需要确保 getRandomWeather 在作用域内可用
            }

            // 2. 更新状态：切换索引 + 解除当前门派的滞留状态
            return {
                ...prev,
                day: nextDay,
                weather: nextWeather,
                activeSectIndex: nextIndex, // 👈 核心：切换到下一个人
                isDayComplete: dayComplete,
                sectStates: {
                    ...prev.sectStates,
                    [activeSectId]: {
                        ...prev.sectStates[activeSectId],
                        skipNextTurn: false // 👈 核心：解除 Debuff
                    }
                },
                globalLog: [
                    ...prev.globalLog,
                    { 
                        day: prev.day, 
                        type: 'move', 
                        content: `【${SECTS[activeSectId].name}】结束滞留状态，整顿完毕。` 
                    }
                ]
            };
        });
        
        // 3. 强制结束函数，不执行后续的 resolveCollisions
        return; 
    }
  
  // --- 新增函数：强制跳过当前回合 ---
  const handleSkipTurn = () => {
      setGameState(prev => {
          const activeSectId = prev.turnQueue[prev.activeSectIndex];
          
          // 1. 计算下一轮次
          let nextIndex = prev.activeSectIndex + 1;
          let nextDay = prev.day;
          let nextWeather = prev.weather;
          let dayComplete = false;

          if (nextIndex >= prev.turnQueue.length) {
              nextIndex = 0;
              nextDay += 1;
              dayComplete = true;
              nextWeather = getRandomWeather();
          }

          // 2. 强制执行：切换下一个人 + 解除当前人的滞留状态
          return {
              ...prev,
              day: nextDay,
              weather: nextWeather,
              activeSectIndex: nextIndex,
              isDayComplete: dayComplete,
              sectStates: {
                  ...prev.sectStates,
                  [activeSectId]: {
                      ...prev.sectStates[activeSectId],
                      skipNextTurn: false // <--- 强制解除滞留
                  }
              },
              globalLog: [
                  ...prev.globalLog,
                  { 
                      day: prev.day, 
                      type: 'move', 
                      content: `【${SECTS[activeSectId].name}】跳过本回合（状态已重置）。` 
                  }
              ]
          };
      });
  };

    setLoading(true);
    // (inputValue 已经在上面定义了，这里直接使用)
    const newProgress = Math.min(GOAL_PROGRESS, activeState.locationProgress + inputValue);
    await resolveCollisions(activeSectId, newProgress);
    setLoading(false);
  };

    setLoading(true);
    const inputValue = parseInt(dmInputValue) || 0;
    const newProgress = Math.min(GOAL_PROGRESS, activeState.locationProgress + inputValue);
    await resolveCollisions(activeSectId, newProgress);
    setLoading(false);
  };

  const resolvePvP = (winnerId: SectId, type: 'BATTLE' | 'NEGOTIATE' | 'COOP') => {
      if (!interaction || !interaction.targetSectId) return;
      const { activeSectId, targetSectId, pendingProgress, locationName } = interaction;
      const loserId = winnerId === activeSectId ? targetSectId : activeSectId;
      const distance = parseInt(interactionValue) || 0;
      let logMsg = manualLogText;
      if (!logMsg) logMsg = type === 'COOP' ? `在${locationName}联手。` : `【${SECTS[winnerId].name}】胜，【${SECTS[loserId].name}】退${distance}里。`;
      if (!logMsg.startsWith(`【${SECTS[activeSectId].name}】`)) logMsg = `【${SECTS[activeSectId].name}】${logMsg}`;

      setInteraction(null);

      if (type !== 'COOP') {
          setGameState(prev => {
              const loserState = prev.sectStates[loserId];
              const retreatedProgress = Math.max(0, loserState.locationProgress - distance);
              return {
                  ...prev,
                  sectStates: { ...prev.sectStates, [loserId]: { ...loserState, locationProgress: retreatedProgress, lastMoveDesc: `退${distance}里` } },
                  globalLog: [...prev.globalLog, { day: prev.day, type: 'conflict', content: logMsg }]
              };
          });
          
          const locationData = getLocationData(pendingProgress);
          GeminiService.generateOpportunityEvent(gameState.sectStates[activeSectId], locationData, gameState.weather).then(eventData => {
             setInteractionStats({ martial: 0, strategy: 0, wealth: 0, prestige: 0 });
             setInteractionValue("0");
             setManualLogText(eventData.title);
             setInteraction({
                type: 'OPPORTUNITY', activeSectId: activeSectId, locationName: locationData.name,
                description: eventData.description, pendingProgress: pendingProgress, eventData: eventData.eventData
             });
          });
      } else {
          const locationData = getLocationData(pendingProgress);
          GeminiService.generateOpportunityEvent(gameState.sectStates[activeSectId], locationData, gameState.weather).then(eventData => {
             setInteractionStats({ martial: 0, strategy: 0, wealth: 0, prestige: 0 });
             setInteractionValue("0");
             setManualLogText(eventData.title);
             setInteraction({
                type: 'OPPORTUNITY', activeSectId: activeSectId, locationName: locationData.name,
                description: eventData.description, pendingProgress: pendingProgress, eventData: eventData.eventData
             });
          });
      }
  };

  // Pre-fill Logic
  const loadEventResultToForm = (result: any, title: string, optionLabel: string) => {
      setInteractionStats({
          martial: result.martial || 0,
          strategy: result.strategy || 0,
          wealth: result.wealth || 0,
          prestige: result.prestige || 0
      });
      setInteractionValue(result.move ? result.move.toString() : "0");
      setApplySkipTurn(result.stopTurn || false);
      
      const activeSectId = interaction?.activeSectId;
      if (!activeSectId) return;

      const narrative = localizeText(result.desc || "", activeSectId);
      const statsStr = formatStatChanges({
          martial: result.martial,
          strategy: result.strategy,
          wealth: result.wealth,
          prestige: result.prestige
      });
      const moveStr = result.move ? ` [里程${result.move > 0 ? '+' : ''}${result.move}]` : "";
      const itemStr = result.item ? ` [获得:${result.item}]` : "";
      const stopStr = result.stopTurn ? ` [滞留]` : "";

      const logMsg = `【${title}】${optionLabel} → ${narrative}${statsStr}${moveStr}${itemStr}${stopStr}`;
      setManualLogText(logMsg);
  };

  const confirmManualEvent = () => {
      if (!interaction) return;
      const { activeSectId, pendingProgress } = interaction;
      
      const moveDelta = parseInt(interactionValue) || 0;
      let finalProgress = pendingProgress + moveDelta;
      finalProgress = Math.max(0, Math.min(GOAL_PROGRESS, finalProgress));
      const finalLoc = getLocationData(finalProgress);

      let logContent = manualLogText || `【奇遇】${interaction.locationName}：命运流转。`;
      if (!logContent.startsWith(`【${SECTS[activeSectId].name}】`)) {
          logContent = `【${SECTS[activeSectId].name}】${logContent}`;
      }
      
      setGameState(prev => {
          const s = prev.sectStates[activeSectId];
          const newVisited = [...s.visitedLocations];
          if (finalLoc.name !== s.currentLocationName) newVisited.push(finalLoc.name);

          return {
              ...prev,
              sectStates: {
                  ...prev.sectStates,
                  [activeSectId]: {
                      ...s,
                      locationProgress: finalProgress,
                      currentLocationName: finalLoc.name,
                      lastMoveDesc: moveDelta !== 0 ? `${moveDelta > 0 ? '+' : ''}${moveDelta}里` : '抵达',
                      skipNextTurn: applySkipTurn,
                      visitedLocations: newVisited,
                      stats: {
                          martial: s.stats.martial + interactionStats.martial,
                          strategy: s.stats.strategy + interactionStats.strategy,
                          wealth: s.stats.wealth + interactionStats.wealth,
                          prestige: s.stats.prestige + interactionStats.prestige,
                      },
                      history: [...s.history, logContent]
                  }
              }
          };
      });
      
      commitTurn(logContent,applyActionAgain);
      setInteraction(null);
  };

  const commitTurn = (logContent: string, actionAgain = false) => {
      setGameState(prev => {
          let nextIndex = prev.activeSectIndex;
          let nextDay = prev.day;
          let nextWeather = prev.weather;
          let dayComplete = false;

          if (!actionAgain) {
              nextIndex = prev.activeSectIndex + 1;
              if (nextIndex >= prev.turnQueue.length) {
                  nextIndex = 0; nextDay += 1; dayComplete = true; nextWeather = getRandomWeather();
              }
          }

          return {
              ...prev, day: nextDay, weather: nextWeather, activeSectIndex: nextIndex, isDayComplete: dayComplete,
              globalLog: [...prev.globalLog, { day: prev.day, type: 'move', content: logContent }]
          };
      });
  };

  // --- Renderers ---

  const renderSetup = () => {
      const bgStyle = tempMapBg 
        ? { backgroundImage: `url(${tempMapBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } 
        : { backgroundColor: '#1c1917' };

      return (
          <div className="flex-1 flex flex-col bg-stone-950 p-8 overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                  <h2 className="text-3xl font-serif text-gold font-bold">天机阁 · 布设棋局</h2>
                  <div className="flex gap-4">
                      <Button onClick={() => setPhase(GamePhase.INTRO)} variant="ghost">返回</Button>
                      <Button onClick={initializeGame} className="px-8">开启棋局</Button>
                  </div>
              </div>

              <div className="flex-1 flex gap-8 min-h-0">
                  <div className="flex-1 flex flex-col gap-4">
                      <div className="flex justify-between items-center">
                          <h3 className="text-stone-400 text-sm font-bold uppercase tracking-wider">地图设定 (21:9)</h3>
                          <div className="flex gap-2">
                              <Button onClick={handleMapUploadClick} variant="secondary" className="text-xs py-1">上传地图</Button>
                              <Button onClick={() => { setIsDrawingPath(!isDrawingPath); if(!isDrawingPath) setTempPath([]); }} variant={isDrawingPath ? 'danger' : 'secondary'} className="text-xs py-1">{isDrawingPath ? '结束绘制' : '重绘路径'}</Button>
                          </div>
                      </div>
                      
                      <div className="flex-1 bg-stone-900 rounded border border-stone-800 flex items-center justify-center p-4">
                          <div 
                            className={`relative w-full shadow-2xl border border-stone-700 overflow-hidden ${isDrawingPath ? 'cursor-crosshair ring-2 ring-gold/50' : ''}`}
                            style={{ aspectRatio: '21 / 9' }}
                            onClick={handleSetupMapClick}
                          >
                               <div className="absolute inset-0" style={bgStyle}>{!tempMapBg && <div className="absolute inset-0 flex items-center justify-center text-stone-700 text-sm">请上传 21:9 比例地图</div>}</div>
                               {tempPath.length > 0 && (
                                   <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                                       <polyline 
                                           points={tempPath.map(p => `${p.x},${p.y}`).join(' ')} 
                                           fill="none" 
                                           stroke="#c5a059" 
                                           strokeWidth="1" 
                                           strokeDasharray="2,2"
                                           vectorEffect="non-scaling-stroke"
                                       />
                                       {tempPath.map((p, i) => (
                                           <circle key={i} cx={p.x} cy={p.y} r="1" fill="#c5a059" vectorEffect="non-scaling-stroke" />
                                       ))}
                                   </svg>
                               )}
                          </div>
                      </div>
                  </div>

                  <div className="w-1/3 flex flex-col gap-4 overflow-hidden">
                      <h3 className="text-stone-400 text-sm font-bold uppercase tracking-wider">门派设定 (棋子 & 立绘)</h3>
                      <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                          {SECT_ORDER.map(sectId => {
                              const sect = SECTS[sectId];
                              const tokenImg = tempSectImages[sectId];
                              const portraitImg = tempSectPortraits[sectId];

                              return (
                                  <div key={sectId} className="bg-stone-900 p-3 rounded border border-stone-800 flex gap-3 items-center">
                                      <div onClick={() => handleSectImageClick(sectId, 'TOKEN')} className="w-12 h-12 rounded border border-stone-700 bg-stone-800 flex items-center justify-center overflow-hidden cursor-pointer hover:border-gold relative group">
                                          {tokenImg ? <img src={tokenImg} className="w-full h-full object-cover" /> : <span className="text-xs text-stone-500">棋子</span>}
                                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[8px] text-white">上传</div>
                                      </div>
                                      <div className="flex-1 min-w-0"><div className={`font-bold text-sm ${sect.color}`}>{sect.name}</div><div className="text-[10px] text-stone-500 truncate">{sect.title}</div></div>
                                      <div onClick={() => handleSectImageClick(sectId, 'PORTRAIT')} className="w-24 aspect-video rounded border border-stone-700 bg-stone-800 flex items-center justify-center overflow-hidden cursor-pointer hover:border-gold relative group">
                                          {portraitImg ? <img src={portraitImg} className="w-full h-full object-cover" /> : <span className="text-[10px] text-stone-500">立绘</span>}
                                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[8px] text-white">上传</div>
                                      </div>
                                  </div>
                              );
                          })}
                      </div>
                      
                      <div className="bg-stone-900 p-4 rounded border border-stone-800">
                          <Button onClick={handleLoadGameClick} variant="secondary" className="w-full text-xs">📂 读取存档</Button>
                      </div>
                  </div>
              </div>
          </div>
      );
  };

  const renderSectDetailModal = () => {
      if (!viewingSectDetail) return null;
      const sect = SECTS[viewingSectDetail];
      const state = gameState.sectStates[viewingSectDetail];
      const portraitImg = gameState.customSectPortraits?.[viewingSectDetail];

      return (
          <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex justify-end">
               <div className="w-full max-w-md h-full bg-stone-900 border-l border-gold shadow-2xl flex flex-col animate-slide-in-right relative">
                   <button onClick={() => setViewingSectDetail(null)} className="absolute top-4 right-4 z-20 text-stone-300 hover:text-white text-2xl drop-shadow-md">&times;</button>
                   
                   <div className="w-full aspect-video relative bg-stone-950 shrink-0">
                       {portraitImg ? <img src={portraitImg} className="w-full h-full object-cover mask-gradient-b" /> : <div className="w-full h-full flex items-center justify-center bg-stone-800 text-stone-600 italic">暂无立绘</div>}
                       <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-transparent to-transparent"></div>
                       <div className="absolute bottom-0 left-0 w-full p-6">
                           <h2 className={`text-4xl font-serif font-bold ${sect.color} mb-1 drop-shadow-md`}>{sect.name}</h2>
                           <p className="text-stone-400 font-serif">{sect.title}</p>
                       </div>
                   </div>

                   <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-stone-900 custom-scrollbar">
                       <div className="grid grid-cols-4 gap-2 text-center p-4 bg-stone-950 rounded border border-stone-800">
                           <div><div className="text-stone-500 text-xs mb-1">武力</div><div className="text-xl text-gold font-serif">{state.stats.martial}</div></div>
                           <div><div className="text-stone-500 text-xs mb-1">智谋</div><div className="text-xl text-gold font-serif">{state.stats.strategy}</div></div>
                           <div><div className="text-stone-500 text-xs mb-1">财富</div><div className="text-xl text-gold font-serif">{state.stats.wealth}</div></div>
                           <div><div className="text-stone-500 text-xs mb-1">威望</div><div className="text-xl text-gold font-serif">{state.stats.prestige}</div></div>
                       </div>
                       <div className="space-y-2"><h3 className="text-stone-500 text-xs font-bold border-b border-stone-800 pb-1">行军路径</h3><div className="flex flex-wrap gap-2">{state.visitedLocations.map((loc, i) => (<div key={i} className="flex items-center text-xs text-stone-400 bg-stone-950 px-2 py-1 rounded border border-stone-800">{i > 0 && <span className="mr-1 text-stone-600">→</span>}{loc}</div>))}</div></div>
                       <div className="space-y-4"><h3 className="text-stone-500 text-xs font-bold border-b border-stone-800 pb-1">门派过往</h3>{state.history.length === 0 ? <div className="text-stone-600 text-sm">暂无记录</div> : state.history.slice().reverse().map((entry, i) => (<div key={i} className="text-stone-300 text-sm border-l border-stone-700 pl-4 py-1 relative"><div className="absolute -left-[5px] top-2 w-2 h-2 rounded-full bg-stone-500"></div>{entry}</div>))}</div>
                   </div>
               </div>
          </div>
      );
  };

  const renderMap = () => {
    const bgStyle = gameState.customMapBg 
      ? { backgroundImage: `url(${gameState.customMapBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } 
      : { backgroundColor: '#1c1917' };

    return (
      <div className="relative w-full h-[400px] shrink-0 border-b border-gold/30 overflow-hidden shadow-2xl bg-stone-900 select-none group perspective-container">
        <div 
             className="absolute w-full h-full preserve-3d transition-transform duration-700 ease-out"
             style={{ 
                 transform: 'rotateX(35deg) scale(0.9) translateY(20px)',
                 transformOrigin: 'center center'
             }}
        >
            <div className="absolute inset-0 shadow-2xl rounded-sm" style={{ ...bgStyle, boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}>{!gameState.customMapBg && <div className="absolute inset-0 flex items-center justify-center text-stone-700 font-serif text-4xl opacity-20">云梦泽 · 逆鳞之路</div>}<div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/canvas.png')] opacity-30 mix-blend-multiply"></div></div>
            {gameState.customPath && gameState.customPath.length > 1 && (<svg className="absolute inset-0 w-full h-full pointer-events-none opacity-50 translate-z-5" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={gameState.customPath.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#c5a059" strokeWidth="1" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" /></svg>)}
            {SECT_ORDER.map(sectId => {
                const sect = SECTS[sectId];
                const state = gameState.sectStates[sectId];
                const isActive = gameState.turnQueue[gameState.activeSectIndex] === sectId;
                const { left, top } = getPathPosition(state.locationProgress, gameState.customPath);
                const customImg = gameState.customSectImages?.[sectId];
                return (
                    <div key={sectId} className={`absolute flex flex-col items-center transition-all duration-1000 ease-in-out preserve-3d ${isActive ? 'z-30' : 'z-10'}`} style={{ left, top, transform: `translate(-50%, -100%) translateZ(${isActive ? '50px' : '10px'})` }}>
                         <div className={`relative origin-bottom transition-transform duration-300 ${isActive ? 'scale-125' : 'scale-100 opacity-90'}`} style={{ transform: 'rotateX(-35deg)' }}>
                             <div className={`w-10 h-10 rounded shadow-xl overflow-hidden bg-stone-800`}>{customImg ? <img src={customImg} className="w-full h-full object-cover" alt={sect.name} /> : <div className={`w-full h-full flex items-center justify-center text-xs font-bold ${sect.color} bg-stone-900`}>{sect.name[0]}</div>}</div>
                             <div className={`absolute -top-5 left-1/2 -translate-x-1/2 bg-black/80 text-[8px] text-gold px-1 rounded whitespace-nowrap border border-gold/20 ${isActive ? 'opacity-100' : 'opacity-0'}`}>{sect.name}</div>
                         </div>
                         <div className="absolute bottom-0 w-8 h-3 bg-black/60 blur-sm rounded-full pointer-events-none" style={{ transform: `translateY(50%) rotateX(0deg) scale(${isActive ? 1.2 : 0.8})`, opacity: isActive ? 0.6 : 0.4 }}></div>
                    </div>
                );
            })}
        </div>
      </div>
    );
  };

  const renderSectBar = () => {
    return (
      <div className="w-full bg-stone-950 border-b border-stone-800 p-4 pb-6 flex items-start justify-center gap-4 shadow-lg z-40 overflow-visible relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-gold/20 to-transparent"></div>
        {SECT_ORDER.map(sectId => {
          const sect = SECTS[sectId];
          const state = gameState.sectStates[sectId];
          const isActive = gameState.turnQueue[gameState.activeSectIndex] === sectId;
          const customImg = gameState.customSectImages?.[sectId];
          const portraitImg = gameState.customSectPortraits?.[sectId];

          return (
            <div key={sectId} onClick={() => setViewingSectDetail(sectId)} className={`group relative flex flex-col items-center cursor-pointer transition-all duration-300 w-24 ${isActive ? 'opacity-100 -translate-y-2' : 'opacity-70 hover:opacity-100 hover:-translate-y-1'}`}>
              <div className={`w-12 h-12 rounded-lg border-2 overflow-hidden flex items-center justify-center bg-stone-900 shadow-md transition-all mb-2 relative ${isActive ? 'border-gold ring-2 ring-gold/30 shadow-[0_0_15px_rgba(197,160,89,0.5)]' : 'border-stone-700'}`}>
                 {customImg ? <img src={customImg} className="w-full h-full object-cover" /> : <span className={`font-serif font-bold text-sm ${sect.color}`}>{sect.name[0]}</span>}
                 {state.skipNextTurn && <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-xs text-red-500 font-bold">停</div>}
              </div>
              <div className="w-full bg-stone-800 h-1.5 rounded-full overflow-hidden mb-1"><div className="bg-gradient-to-r from-yellow-600 to-gold h-full" style={{ width: `${(state.locationProgress / GOAL_PROGRESS) * 100}%` }}></div></div>
              <div className="text-center w-full"><div className="text-[10px] text-stone-300 truncate font-serif leading-tight">{state.currentLocationName}</div><div className={`text-[10px] font-mono font-bold ${state.lastMoveDesc.includes('+') ? 'text-green-400' : state.lastMoveDesc.includes('-') ? 'text-crimson' : 'text-stone-500'}`}>{state.lastMoveDesc}</div></div>
              <div className="absolute bottom-full mb-4 opacity-0 group-hover:opacity-100 transition-all duration-500 ease-out transform translate-y-4 group-hover:translate-y-0 pointer-events-none z-50"><div className="w-64 bg-stone-900 border border-gold/40 rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col"><div className="w-full aspect-video bg-stone-950 relative">{portraitImg ? <img src={portraitImg} className="w-full h-full object-cover opacity-90" /> : <div className="w-full h-full flex items-center justify-center text-stone-700 text-xs italic">暂无立绘</div>}<div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-transparent to-transparent"></div><div className="absolute bottom-0 left-0 w-full p-3"><div className={`font-serif font-bold text-lg leading-none ${sect.color} drop-shadow-md`}>{sect.name}</div><div className="text-[10px] text-stone-400 mt-1">{sect.title}</div></div></div><div className="p-2 bg-stone-900 border-t border-stone-800 grid grid-cols-4 gap-1 text-[10px] text-stone-400 font-mono text-center"><div className="bg-stone-800/50 rounded px-1">武 {state.stats.martial}</div><div className="bg-stone-800/50 rounded px-1">智 {state.stats.strategy}</div><div className="bg-stone-800/50 rounded px-1">财 {state.stats.wealth}</div><div className="bg-stone-800/50 rounded px-1">望 {state.stats.prestige}</div></div></div></div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderInteractionModal = () => {
      if (!interaction) return null;
      const event = interaction.eventData; 
      const activeSectId = interaction.activeSectId;
      const displayNarrative = event ? localizeText(event.narrative, activeSectId) : interaction.description;

      if (interaction.type === 'PVP') {
          return (
              <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
                  <div className="bg-stone-900 border border-crimson p-6 max-w-lg w-full">
                      <h2 className="text-2xl text-crimson font-serif font-bold mb-4 text-center">⚔️ {interaction.description}</h2>
                      <div className="bg-stone-800/50 p-4 rounded mb-4 border border-stone-700"><label className="text-xs text-stone-400 block mb-2 font-bold">败者/退让者 回退里程</label><div className="flex items-center justify-center gap-2"><input type="number" value={interactionValue} onChange={(e) => setInteractionValue(e.target.value)} className="w-20 bg-stone-950 border border-gold text-gold text-center p-1 rounded" /><span className="text-stone-500 text-xs">里</span></div><textarea className="w-full bg-stone-900 border border-stone-700 mt-2 p-2 text-xs text-stone-300 rounded h-16" placeholder="自定义战报..." value={manualLogText} onChange={(e) => setManualLogText(e.target.value)} /></div>
                      <div className="flex gap-2 justify-center"><Button onClick={() => resolvePvP(interaction.activeSectId, 'BATTLE')} variant="danger" className="text-xs">{SECTS[activeSectId].name} 胜</Button><Button onClick={() => resolvePvP(interaction.targetSectId!, 'BATTLE')} variant="danger" className="text-xs">{SECTS[interaction.targetSectId!].name} 胜</Button><Button onClick={() => resolvePvP(interaction.activeSectId, 'COOP')} variant="secondary" className="text-xs">🤝 联手</Button></div>
                  </div>
              </div>
          );
      }

      return (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
              <div className="bg-stone-900 border border-gold max-w-2xl w-full my-8 animate-fade-in-up flex flex-col max-h-[90vh]">
                  <div className="p-4 border-b border-stone-800 bg-stone-950 flex justify-between shrink-0"><h2 className="text-xl text-gold font-serif">{event?.title || '奇遇'}</h2><span className="text-stone-500 text-xs">{interaction.locationName}</span></div>
                  <div className="p-6 overflow-y-auto custom-scrollbar">
                      <p className="text-stone-300 mb-6 leading-relaxed whitespace-pre-wrap text-sm">{displayNarrative}</p>
                      <div className="grid grid-cols-1 gap-4 mb-6">
                          {event?.options.map((opt, idx) => (
                              <div key={idx} className="p-3 border border-stone-700 bg-stone-800/30 rounded">
                                  <div className="flex justify-between items-center mb-2"><h3 className="text-gold font-bold text-sm">{opt.label}</h3><span className="text-[10px] bg-stone-800 px-2 py-1 rounded text-stone-400">判定: {opt.reqText}</span></div>
                                  <div className="grid grid-cols-2 gap-2">
                                      <button className="p-2 bg-green-900/20 border border-green-900/50 rounded hover:bg-green-900/30 text-left transition-colors group" onClick={() => loadEventResultToForm(opt.success, event.title, opt.label + " (成功)")}><span className="text-green-400 text-xs font-bold block group-hover:text-green-300">✅ 判定成功</span><p className="text-stone-500 text-[10px] line-clamp-2">{localizeText(opt.success.desc || "", activeSectId)}</p></button>
                                      <button className="p-2 bg-red-900/20 border border-red-900/50 rounded hover:bg-red-900/30 text-left transition-colors group" onClick={() => loadEventResultToForm(opt.fail, event.title, opt.label + " (失败)")}><span className="text-red-400 text-xs font-bold block group-hover:text-red-300">❌ 判定失败</span><p className="text-stone-500 text-[10px] line-clamp-2">{localizeText(opt.fail.desc || "", activeSectId)}</p></button>
                                  </div>
                              </div>
                          ))}
                      </div>

                      <div className="bg-stone-950 p-4 rounded border border-gold/30">
                          <h4 className="text-gold font-bold text-xs mb-3 border-b border-stone-800 pb-1">⚡ DM 裁决控制台 (确认后生效)</h4>
                          <div className="grid grid-cols-2 gap-4 mb-4">
                              <div className="space-y-2"><div className="flex justify-between text-xs text-stone-400"><span>里程修正</span><span>(正进负退)</span></div><div className="flex items-center gap-2"><input type="number" value={interactionValue} onChange={e=>setInteractionValue(e.target.value)} className="w-full bg-stone-900 border border-stone-700 p-1 text-center text-gold font-bold rounded" /><span className="text-xs text-stone-500">里</span></div></div>
                              <div className="flex items-end gap-2 pb-1"><button onClick={()=>setApplySkipTurn(!applySkipTurn)} className={`flex-1 py-1 text-[10px] border rounded ${applySkipTurn?'bg-crimson border-crimson text-white':'border-stone-600 text-stone-500'}`}>🛑 滞留</button><button onClick={()=>setApplyActionAgain(!applyActionAgain)} className={`flex-1 py-1 text-[10px] border rounded ${applyActionAgain?'bg-emerald-600 border-emerald-600 text-white':'border-stone-600 text-stone-500'}`}>⏩ 连动</button></div>
                          </div>
                          <div className="grid grid-cols-4 gap-2 mb-4">
                              <StatInput label="武力" value={interactionStats.martial} onChange={e=>setInteractionStats({...interactionStats, martial: e})} />
                              <StatInput label="智谋" value={interactionStats.strategy} onChange={e=>setInteractionStats({...interactionStats, strategy: e})} />
                              <StatInput label="财富" value={interactionStats.wealth} onChange={e=>setInteractionStats({...interactionStats, wealth: e})} />
                              <StatInput label="威望" value={interactionStats.prestige} onChange={e=>setInteractionStats({...interactionStats, prestige: e})} />
                          </div>
                          <textarea className="w-full bg-stone-900 border border-stone-700 p-2 text-xs text-stone-300 rounded h-16 mb-4" placeholder="事件结果描述 (将写入日志)..." value={manualLogText} onChange={(e) => setManualLogText(e.target.value)} />
                          <Button onClick={confirmManualEvent} className="w-full py-3 text-sm">✅ 执行裁决</Button>
                      </div>
                  </div>
              </div>
          </div>
      );
  };

  const renderMainArea = () => {
    const activeSectId = gameState.turnQueue[gameState.activeSectIndex];
    const activeSect = SECTS[activeSectId];
    const activeState = gameState.sectStates[activeSectId];
    const activePortrait = gameState.customSectPortraits?.[activeSectId];
    // const logsByDay = gameState.globalLog.reduce((acc, log) => { if (!acc[log.day]) acc[log.day] = []; acc[log.day].push(log); return acc; }, {} as Record<number, LogEntry[]>);
    const isDari = activeSectId === SectId.DARI;
    const titleClass = isDari ? 'text-amber-400' : activeSect.color;
    const titleShadow = isDari ? { textShadow: '0 0 10px #fbbf24, 0 0 20px #d97706' } : { textShadow: '0 0 10px currentColor' };

    return (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-stone-900 min-h-0">
            <div className="w-full md:w-[340px] shrink-0 p-4 border-r border-stone-800 bg-stone-950/90 flex flex-col gap-4 relative z-10 shadow-2xl overflow-y-auto">
                 <div><div className={`text-3xl font-serif font-bold tracking-widest mb-2 ${titleClass}`} style={titleShadow}>{activeSect.name}</div><div className="flex justify-between items-center text-xs text-stone-500 font-serif border-b border-stone-800 pb-2"><span>{activeSect.title}</span><span className="text-gold">第 {gameState.day} 日</span></div></div>
                 <div className="w-full aspect-video bg-stone-900 rounded border border-stone-800 relative overflow-hidden shadow-inner group">{activePortrait ? <img src={activePortrait} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" /> : <div className="w-full h-full flex items-center justify-center text-stone-700 italic text-sm">暂无立绘</div>}<div className="absolute top-2 right-2 bg-black/60 px-2 py-1 rounded text-[10px] text-stone-300 border border-stone-700 backdrop-blur-md flex items-center gap-1"><span>🌤️</span> {gameState.weather.split(' - ')[0]}</div></div>
                 <div className="grid grid-cols-2 gap-3 bg-stone-900/50 p-3 rounded border border-stone-800"><StatInput label="🗡️ 武力" value={activeState.stats.martial} onChange={v=>handleStatEdit(activeSectId, 'martial', v)} /><StatInput label="📜 智谋" value={activeState.stats.strategy} onChange={v=>handleStatEdit(activeSectId, 'strategy', v)} /><StatInput label="💰 财富" value={activeState.stats.wealth} onChange={v=>handleStatEdit(activeSectId, 'wealth', v)} /><StatInput label="👑 威望" value={activeState.stats.prestige} onChange={v=>handleStatEdit(activeSectId, 'prestige', v)} /></div>
                 <div className="bg-stone-900 p-4 rounded border border-stone-700 shadow-inner">
    <div className="flex justify-between items-center mb-2">
        <label className="text-[10px] text-stone-500 uppercase tracking-widest">移动裁决</label>
        <span className="text-[10px] text-stone-600">单位：里</span>
    </div>
    <div className="flex gap-2 h-12">
        <div className="relative w-20 shrink-0">
            <input 
                type="number" 
                value={dmInputValue} 
                onChange={e=>setDmInputValue(e.target.value)} 
                className="w-full h-full bg-stone-950 border border-stone-600 text-gold text-2xl font-serif font-bold text-center rounded focus:border-gold focus:ring-1 focus:ring-gold/30 focus:outline-none transition-all"
            />
        </div>
        <Button 
            onClick={handleTurnStart} 
            disabled={loading} 
            className="flex-1 text-base tracking-widest shadow-[0_4px_10px_rgba(0,0,0,0.3)] border-gold/50"
            icon={loading ? <span className="animate-spin">⏳</span> : <span>🐎</span>}
        >
            {loading ? '行军中...' : '立即进军'}
        </Button>
    </div>
</div>
                 <div className="mt-auto grid grid-cols-3 gap-2"><Button variant="secondary" onClick={handleSaveGame} className="text-xs py-1">💾 保存</Button><Button variant="secondary" onClick={handleLoadGameClick} className="text-xs py-1">📂 读取</Button><Button variant="ghost" onClick={handleMapUploadClick} className="text-xs py-1">🗺️ 地图</Button></div>
            </div>
            <div className="flex-1 p-8 overflow-y-auto bg-[#131110] relative custom-scrollbar">
                <h3 className="text-stone-500 text-xs font-bold mb-6 border-b border-stone-800 pb-2 sticky top-0 bg-[#131110] z-10">江湖志 · 实时卷宗</h3>
                <div className="space-y-6">
                    {gameState.globalLog.slice().reverse().map((log, i) => (<div key={i} className={`relative pl-6 border-l-2 transition-all duration-500 ${log.type==='conflict'?'border-crimson/50':log.type==='event'?'border-gold/50':'border-stone-700'}`}><div className={`absolute -left-[5px] top-0 w-2 h-2 rounded-full ${log.type==='conflict'?'bg-crimson':log.type==='event'?'bg-gold':'bg-stone-600'}`}></div><div className="text-[10px] text-stone-500 mb-1 font-mono">第 {log.day} 日</div><div className={`text-sm leading-relaxed font-serif ${log.type==='conflict'?'text-rose-200':log.type==='event'?'text-amber-100':'text-stone-300'}`}>{log.content}</div></div>))}
                    <div ref={logEndRef}></div>
                </div>
            </div>
        </div>
    );
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#0c0a09] font-sans text-stone-200 overflow-hidden">
        <div style={{ display: 'none' }}><input type="file" ref={fileInputRef} accept=".json" onChange={handleFileChange} /><input type="file" ref={mapInputRef} accept="image/*" onChange={handleMapFileChange} /><input type="file" ref={sectImageInputRef} accept="image/*" onChange={handleSectImageChange} /></div>
        {phase === GamePhase.MAIN_LOOP ? (
            <>{renderMap()}{renderSectBar()}{renderMainArea()}{renderInteractionModal()}{renderSectDetailModal()}</>
        ) : phase === GamePhase.SETUP ? renderSetup() : (
             <div className="relative flex-1 flex flex-col items-center justify-center space-y-12 bg-[url('https://www.transparenttextures.com/patterns/rice-paper-3.png')]"><div className="z-10 text-center space-y-4"><h1 className="text-8xl font-serif text-transparent bg-clip-text bg-gradient-to-b from-[#c5a059] to-[#8a6a28] tracking-[0.3em] drop-shadow-2xl filter contrast-125">七曜 · 逆鳞</h1><p className="text-stone-500 font-serif tracking-[0.5em] text-xl uppercase">The Seven Luminaries</p></div><div className="z-10"><Button onClick={startSetup} className="text-2xl px-16 py-5 border-[#c5a059] text-[#c5a059] hover:bg-[#c5a059] hover:text-black transition-all duration-500">开启江湖</Button></div></div>
        )}
    </div>
  );
};

export default App;
