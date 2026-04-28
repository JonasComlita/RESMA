import { create } from 'zustand';

interface DashboardState {
    platform: string;
    setPlatform: (platform: string) => void;
    
    region: string;
    setRegion: (region: string) => void;
    
    maxDepth: number;
    setMaxDepth: (depth: number) => void;
    
    selectedCohortId: string | null;
    setSelectedCohortId: (id: string | null) => void;
    
    seedVideoId: string;
    setSeedVideoId: (id: string) => void;
    
    forecastSeedVideoId: string;
    setForecastSeedVideoId: (id: string) => void;
    
    beamWidth: number;
    setBeamWidth: (width: number) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
    platform: 'youtube',
    setPlatform: (platform) => set({ platform }),
    
    region: 'Global',
    setRegion: (region) => set({ region }),
    
    maxDepth: 3,
    setMaxDepth: (maxDepth) => set({ maxDepth }),
    
    selectedCohortId: null,
    setSelectedCohortId: (selectedCohortId) => set({ selectedCohortId }),
    
    seedVideoId: '',
    setSeedVideoId: (seedVideoId) => set({ seedVideoId }),
    
    forecastSeedVideoId: '',
    setForecastSeedVideoId: (forecastSeedVideoId) => set({ forecastSeedVideoId }),
    
    beamWidth: 5,
    setBeamWidth: (beamWidth) => set({ beamWidth }),
}));
