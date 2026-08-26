import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';

export type GalleryPhoto = {
  id: string;
  originalUri: string;
  originalWidth: number;
  originalHeight: number;
  uri: string;
  width: number;
  height: number;
  inferenceMs?: number;
  embedding?: number[];
  tags?: string[];
  caption?: string;
};

type GalleryPhotosContextValue = {
  photos: GalleryPhoto[];
  addPhoto: (photo: { uri: string; width: number; height: number }) => string;
  updatePhoto: (id: string, patch: Partial<Omit<GalleryPhoto, 'id'>>) => void;
};

const GalleryPhotosContext = createContext<GalleryPhotosContextValue | null>(null);

export function GalleryPhotosProvider({ children }: { children: ReactNode }) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const nextPhotoId = useRef(1);

  const addPhoto = useCallback((source: { uri: string; width: number; height: number }) => {
    const id = `photo-${nextPhotoId.current}`;
    const photo = {
      id,
      originalUri: source.uri,
      originalWidth: source.width,
      originalHeight: source.height,
      uri: source.uri,
      width: source.width,
      height: source.height,
    };

    nextPhotoId.current += 1;
    setPhotos((currentPhotos) => [...currentPhotos, photo]);
    return id;
  }, []);

  const updatePhoto = useCallback(
    (id: string, patch: Partial<Omit<GalleryPhoto, 'id'>>) => {
      setPhotos((currentPhotos) =>
        currentPhotos.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo))
      );
    },
    []
  );

  return (
    <GalleryPhotosContext.Provider value={{ photos, addPhoto, updatePhoto }}>
      {children}
    </GalleryPhotosContext.Provider>
  );
}

export function useGalleryPhotos() {
  const context = useContext(GalleryPhotosContext);

  if (!context) {
    throw new Error('useGalleryPhotos must be used inside GalleryPhotosProvider');
  }

  return context;
}
