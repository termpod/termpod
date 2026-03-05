import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';

interface QuickActionsProps {
  onAction: (value: string) => void;
}

const ACTIONS = [
  { label: 'Ctrl+C', value: '\x03' },
  { label: 'Enter', value: '\r' },
  { label: 'Tab', value: '\t' },
  { label: 'Up', value: '\x1b[A' },
  { label: 'Down', value: '\x1b[B' },
  { label: 'Esc', value: '\x1b' },
];

export function QuickActions({ onAction }: QuickActionsProps) {
  const handlePress = (value: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onAction(value);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
      style={styles.scroll}
    >
      {ACTIONS.map((action) => (
        <TouchableOpacity
          key={action.label}
          style={styles.button}
          onPress={() => handlePress(action.value)}
          activeOpacity={0.6}
        >
          <Text style={styles.label}>{action.label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    flexShrink: 0,
    maxHeight: 52,
    backgroundColor: '#16161e',
    borderTopWidth: 1,
    borderTopColor: '#292e42',
  },
  container: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#292e42',
    backgroundColor: '#1a1b26',
  },
  label: {
    color: '#a9b1d6',
    fontSize: 13,
    fontFamily: 'Menlo',
  },
});
