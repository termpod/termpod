'use client';

import Image from 'next/image';
import { useState } from 'react';

/**
 * Renders a screenshot if the image loads, otherwise renders fallback children.
 *
 * To replace a mockup with a real screenshot:
 * 1. Take a screenshot and save it to public/screenshots/
 * 2. The <Screenshot> component already references it — it will auto-switch
 *
 * File naming convention:
 *   public/screenshots/hero-mac.png       — Hero section Mac terminal
 *   public/screenshots/hero-iphone.png    — Hero section iPhone
 *   public/screenshots/feature-stream.png — Feature 1: Streaming terminal
 *   public/screenshots/feature-sessions.png — Feature 3: Session list
 *   public/screenshots/uc-migrate.png     — Use case 1: Migration
 *   public/screenshots/uc-deploy.png      — Use case 2: Deploy prompt
 *   public/screenshots/uc-monitor.png     — Use case 3: Server health
 */
export function Screenshot({
  src,
  alt,
  width,
  height,
  className,
  children,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  children: React.ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  return (
    <>
      {!errored && (
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className={`${loaded ? '' : 'hidden'} ${className ?? ''}`}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          unoptimized
        />
      )}
      {!loaded && <>{children}</>}
    </>
  );
}
