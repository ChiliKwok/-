
export enum SectId {
  TIANHE = 'TIANHE',       // 天河剑宗
  BEIGE = 'BEIGE',         // 悲歌书院
  WANGSHENG = 'WANGSHENG', // 往生门
  FULONG = 'FULONG',       // 伏龙山庄
  NANTUO = 'NANTUO',       // 难陀山
  XUEYI = 'XUEYI',         // 雪衣楼
  DARI = 'DARI'            // 大日琉璃宫
}

export interface SectInfo {
  id: SectId;
  name: string;
  title: string;
  description: string;
  bonus: string;
  weapon: string;
  color: string;
  bgColor: string;
  image: string;
}

// --- New Rulebook Types ---

export interface EventResult {
  desc?: string; // Narrative result
  stats?: {
    martial?: number;
    strategy?: number;
    wealth?: number;
    prestige?: number;
  };
  move?: number; // Relative movement (e.g. +5, -3)
  item?: string; // Gained item name
  stopTurn?: boolean; // Skip next turn
}

export interface EventOption {
  label: string;
  reqText: string; // e.g. "武力 ≥ 25"
  checkStat: 'martial' | 'strategy' | 'wealth' | 'prestige' | 'none';
  checkVal: number; // Threshold
  success: EventResult;
  fail: EventResult;
}

export interface GameEvent {
  title: string;
  narrative: string;
  options: [EventOption, EventOption]; // Always 2 options for simplicity A/B
}

export interface LocationData {
  id: number;
  name: string;
  desc: string;
  event?: GameEvent; // The fixed event for this location
}

// --------------------------

export interface SectState {
  id: SectId;
  locationProgress: number; // 0 to 120
  currentLocationName: string; 
  stats: {
    martial: number;   // 武力
    strategy: number;  // 智谋
    wealth: number;    // 财富
    prestige: number;  // 威望
  };
  history: string[];
  visitedLocations: string[];
  lastMoveDesc: string;
  skipNextTurn: boolean;
}

export interface LogEntry {
  day: number;
  content: string;
  type: 'move' | 'conflict' | 'event' | 'system';
}

export interface Point {
  x: number;
  y: number;
}

export interface GameState {
  day: number;
  weather: string;
  activeSectIndex: number;
  turnQueue: SectId[];
  isDayComplete: boolean;
  sectStates: Record<SectId, SectState>;
  globalLog: LogEntry[];
  
  // Customization
  customMapBg?: string;
  customPath?: Point[];
  customSectImages?: Record<string, string>;
  customSectPortraits?: Record<string, string>;
}

export type InteractionType = 'PVP' | 'OPPORTUNITY';

export interface InteractionState {
  type: InteractionType;
  activeSectId: SectId;
  targetSectId?: SectId; // For PvP
  locationName: string;
  description: string; // For Opportunity: "Title|||Narrative|||OptionsJSON"
  // For PvP, this is just descriptive text
  
  // Pending values
  pendingProgress: number; 
  // For Fixed Events, we store the actual event object temporarily
  eventData?: GameEvent;
}

export enum GamePhase {
  INTRO = 'INTRO',
  SETUP = 'SETUP',
  MAIN_LOOP = 'MAIN_LOOP',
  ENDING = 'ENDING'
}
