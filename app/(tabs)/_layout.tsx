import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';

import { GalleryPhotosProvider } from '@/components/GalleryPhotosContext';

function TabBarIcon({
  name,
  color,
}: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome name={name} size={24} color={color} />;
}

export default function TabLayout() {
  return (
    <GalleryPhotosProvider>
      <Tabs screenOptions={{ headerShown: false }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Create',
            tabBarIcon: ({ color }) => <TabBarIcon name="plus-circle" color={color} />,
          }}
        />
        <Tabs.Screen
          name="gallery"
          options={{
            title: 'Gallery',
            tabBarIcon: ({ color }) => <TabBarIcon name="image" color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color }) => <TabBarIcon name="cog" color={color} />,
          }}
        />
      </Tabs>
    </GalleryPhotosProvider>
  );
}
