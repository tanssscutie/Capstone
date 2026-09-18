// components/ui/ScreenScroll.tsx
// Drop-in replacement for React Native's ScrollView that feeds its scroll
// offset into HeaderScrollContext, so the floating AppHeader (AppHeader.tsx)
// can condense as this screen's content scrolls — the behavior it's built
// for (shrinking logo, hiding search, hiding the tier line) but that never
// actually happened anywhere in the app, because no screen was providing a
// scroll value into that context. Every screen's primary ScrollView should
// use this instead of importing ScrollView directly.
import { forwardRef, useRef } from 'react';
import { Animated, ScrollView } from 'react-native';
import type { ScrollViewProps } from 'react-native';
import { HeaderScrollContext } from './HeaderScrollContext';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

const ScreenScroll = forwardRef<ScrollView, ScrollViewProps>(function ScreenScroll(props, ref) {
  const scrollY = useRef(new Animated.Value(0)).current;

  return (
    <HeaderScrollContext.Provider value={scrollY}>
      <AnimatedScrollView
        ref={ref}
        {...props}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false, listener: props.onScroll },
        )}
        scrollEventThrottle={props.scrollEventThrottle ?? 16}
      />
    </HeaderScrollContext.Provider>
  );
});

export default ScreenScroll;
