import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';

interface DetectedPrompt {
  tool: string;
  detail: string;
}

interface PromptBarProps {
  prompt: DetectedPrompt;
  onAccept: () => void;
  onDeny: () => void;
}

export function PromptBar({ prompt, onAccept, onDeny }: PromptBarProps) {
  const handleAccept = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onAccept();
  };

  const handleDeny = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onDeny();
  };

  return (
    <View style={styles.container}>
      <View style={styles.info}>
        <Text style={styles.tool}>{prompt.tool}</Text>
        <Text style={styles.detail} numberOfLines={1}>{prompt.detail}</Text>
      </View>
      <View style={styles.buttons}>
        <TouchableOpacity style={styles.denyBtn} onPress={handleDeny} activeOpacity={0.7}>
          <Text style={styles.denyText}>Deny</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} activeOpacity={0.7}>
          <Text style={styles.acceptText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1e2030',
    borderTopWidth: 1,
    borderTopColor: '#3d59a1',
  },
  info: {
    flex: 1,
    gap: 2,
  },
  tool: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7aa2f7',
    fontFamily: 'Menlo',
  },
  detail: {
    fontSize: 11,
    color: '#a9b1d6',
  },
  buttons: {
    flexDirection: 'row',
    gap: 8,
  },
  denyBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#e05050',
  },
  denyText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  acceptBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#50c878',
  },
  acceptText: {
    color: '#1a1b26',
    fontSize: 13,
    fontWeight: '600',
  },
});
