
import { SectState, LocationData, GameEvent } from "../types";
import { SECTS, FIXED_LOCATIONS, WEATHERS } from "../constants";

// Local Game Engine (Replaces AI)

const getRandomWeather = () => WEATHERS[Math.floor(Math.random() * WEATHERS.length)];

// Format text with replacements
const formatNarrative = (text: string, sectName: string, locationName: string, weather: string) => {
    return text
        .replace(/{Sect}/g, sectName)
        .replace(/{Location}/g, locationName)
        .replace(/{Weather}/g, weather);
};

// --- Turn Event (Narrative only) ---
export const generateTurnEvent = async (
  sectState: SectState, 
  location: LocationData, 
  day: number,
  weather: string,
  inputValue: number
): Promise<{ locationName: string; eventText: string; effectSummary: string }> => {
    
    const sect = SECTS[sectState.id];
    // Simple descriptive text for the move phase
    const narratives = [
        `第${day}日，${weather}。${sect.name}行至【${location.name}】。${location.desc}`,
        `【${location.name}】。${weather}之下，${sect.name}众人脚步不停。${location.desc}`,
        `抵达【${location.name}】，${location.desc}大家稍作修整，准备迎接挑战。`
    ];
    const text = narratives[Math.floor(Math.random() * narratives.length)];

    return {
        locationName: location.name,
        eventText: text,
        effectSummary: "行军赶路"
    };
}

// --- Conflict (PvP) ---
export const generateConflictNarrative = async (
    sectAId: string,
    sectBId: string,
    location: string,
    weather: string
): Promise<string> => {
    const sectA = SECTS[sectAId as any];
    const sectB = SECTS[sectBId as any];
    return `在【${location}】，${sectA.name}与${sectB.name}狭路相逢。${weather}中，双方对峙，互不相让。`;
}

// --- Opportunity Event (The Rulebook Lookup) ---
export const generateOpportunityEvent = async (
    sectState: SectState,
    location: LocationData, 
    weather: string
): Promise<{ title: string; description: string, eventData?: GameEvent }> => {
    
    // Look up fixed event from constants
    // Note: FIXED_LOCATIONS is 0-indexed, id matches index
    const fixedLoc = FIXED_LOCATIONS.find(l => l.id === location.id);
    const event = fixedLoc?.event;

    if (!event) {
        // Fallback for locations without events (shouldn't happen for 1-100 if fully populated)
        return {
            title: "荒野赶路",
            description: `【${location.name}】\n${weather}。\n平安无事，继续前行。|||无特殊判定。`
        };
    }

    // Format for App.tsx consumption
    // Title ||| Narrative ||| Options (we pass the raw object in a separate field really, but for text display:)
    // Actually App.tsx parses text, but we will pass the object directly in a new property `eventData`
    
    return {
        title: event.title,
        description: `${event.title}|||${event.narrative}|||请选择行动。`, // Legacy text format
        eventData: event // The structured data for the UI to render buttons
    };
}
