import React from 'react';
import { MapContainer, TileLayer, Polyline, Popup, Tooltip, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Import the LocationModel type from Dashboard
interface LocationModel {
  lat: number;
  lng: number;
  timestamp: number;
}

interface LocationTimelineMapProps {
  locationTimeline: LocationModel[];
}

const LocationTimelineMap: React.FC<LocationTimelineMapProps> = ({ locationTimeline }) => {
  // If no timeline data, don't render the map
  if (!locationTimeline || locationTimeline.length === 0) {
    return <div className="p-4 text-center text-gray-500">No location data available</div>;
  }

  // Extract positions for the polyline
  const positions = locationTimeline.map(loc => [loc.lat, loc.lng] as [number, number]);
  
  // Find center of the map (average of all points)
  const center = locationTimeline.length > 0 
    ? [
        locationTimeline.reduce((sum, loc) => sum + loc.lat, 0) / locationTimeline.length,
        locationTimeline.reduce((sum, loc) => sum + loc.lng, 0) / locationTimeline.length
      ] as [number, number]
    : [0, 0] as [number, number];

  // Format timestamp to readable time (short format: HH:MM)
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="w-full h-[400px] rounded-lg overflow-hidden shadow-md" style={{ maxWidth: '800px', margin: '0 auto' }}>
      <MapContainer 
        center={center} 
        zoom={13} 
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {/* Draw the path as a polyline */}
        <Polyline 
          positions={positions} 
          color="blue" 
          weight={3} 
          opacity={0.7}
        />
        
        {/* Add circle markers for each location point with timestamps */}
        {locationTimeline.map((location, index) => (
          <CircleMarker 
            key={index} 
            center={[location.lat, location.lng]}
            radius={5}
            fillColor="#3b82f6" 
            fillOpacity={0.8}
            color="#1d4ed8"
            weight={1}
          >
            <Tooltip permanent direction="top" offset={[0, -10]} opacity={0.7} className="text-xs">
              <span className="text-xs font-light opacity-70">{formatTime(location.timestamp)}</span>
            </Tooltip>
            <Popup>
              <div>
                <strong>Time:</strong> {formatTime(location.timestamp)}
                <br />
                <strong>Position:</strong> {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
};

export default LocationTimelineMap;
