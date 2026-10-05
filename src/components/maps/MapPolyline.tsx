import React, { useEffect, useRef } from 'react';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Coordinate } from '../../maps/types.ts';

interface MapPolylineProps {
  path: Coordinate[];
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  isActive?: boolean;
}

export const MapPolyline: React.FC<MapPolylineProps> = ({
  path,
  strokeColor = '#0d9488',
  strokeOpacity = 0.8,
  strokeWeight = 4,
  isActive = true,
}) => {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const polylineRef = useRef<any>(null);

  useEffect(() => {
    if (!map || !mapsLib || !path || path.length < 2) return;

    const polyline = new (mapsLib as any).Polyline({
      path,
      geodesic: true,
      strokeColor: isActive ? strokeColor : '#94a3b8',
      strokeOpacity: isActive ? strokeOpacity : 0.4,
      strokeWeight: isActive ? strokeWeight : 3,
      map,
    });

    polylineRef.current = polyline;

    return () => {
      polyline.setMap(null);
    };
  }, [map, mapsLib, path, strokeColor, strokeOpacity, strokeWeight, isActive]);

  return null;
};
