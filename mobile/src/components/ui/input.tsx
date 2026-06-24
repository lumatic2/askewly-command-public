import * as React from 'react';
import { Platform, TextInput } from 'react-native';

import { cn } from '../../lib/utils';

const typeface = Platform.select({ ios: 'System', android: 'sans-serif', default: undefined });

type InputProps = React.ComponentPropsWithoutRef<typeof TextInput>;

const Input = React.forwardRef<TextInput, InputProps>(({ className, ...props }, ref) => {
  return (
    <TextInput
      ref={ref}
      className={cn(
        'border-input bg-background text-foreground flex h-10 w-full min-w-0 flex-row items-center rounded-md border px-3 py-1 text-base leading-5 shadow-sm shadow-black/5 sm:h-9',
        props.editable === false &&
          cn('opacity-50', Platform.select({ web: 'disabled:pointer-events-none disabled:cursor-not-allowed' })),
        Platform.select({
          web: cn(
            'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground outline-none transition-[color,box-shadow] md:text-sm',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'
          ),
          native: 'placeholder:text-muted-foreground/50'
        }),
        className
      )}
      style={[{ fontFamily: typeface }, props.style]}
      {...props}
    />
  );
});

Input.displayName = 'Input';

export { Input };
