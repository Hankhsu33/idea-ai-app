import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';

type GalleryPhoto = {
  id: string;
  uri: string;
};

type GalleryPhotosContextValue = {
  photos: GalleryPhoto[];
  addPhoto: (uri: string) => void;
};

const GalleryPhotosContext = createContext<GalleryPhotosContextValue | null>(null);

export function GalleryPhotosProvider({ children }: { children: ReactNode }) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const nextPhotoId = useRef(1);

  const addPhoto = useCallback((uri: string) => {
    const photo = {
      id: `photo-${nextPhotoId.current}`,
      uri,
    };

    nextPhotoId.current += 1;
    setPhotos((currentPhotos) => [...currentPhotos, photo]);
  }, []);

  return (
    <GalleryPhotosContext.Provider value={{ photos, addPhoto }}>
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
