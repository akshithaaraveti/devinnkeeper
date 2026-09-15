import { useDialogComposition } from "@/components/ui/dialog";
import { useComposition } from "@/hooks/useComposition";
import { cn } from "@/lib/utils";
import * as React from "react";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onKeyDown, onCompositionStart, onCompositionEnd, ...props }, ref) => {
    // Get dialog composition context if available (will be no-op if not inside Dialog)
    const dialogComposition = useDialogComposition();

    // Add composition event handlers to support input method editor (IME) for CJK languages.
    const {
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
      onKeyDown: handleKeyDown,
    } = useComposition<HTMLInputElement>({
      onKeyDown: (e) => {
        // Check if this is an Enter key that should be blocked
        const isComposing = (e.nativeEvent as any).isComposing || dialogComposition.justEndedComposing();

        // If Enter key is pressed while composing or just after composition ended,
        // don't call the user's onKeyDown (this blocks the business logic)
        if (e.key === "Enter" && isComposing) {
          return;
        }

        // Otherwise, call the user's onKeyDown
        onKeyDown?.(e);
      },
      onCompositionStart: e => {
        dialogComposition.setComposing(true);
        onCompositionStart?.(e);
      },
      onCompositionEnd: e => {
        // Mark that composition just ended - this helps handle the Enter key that confirms input
        dialogComposition.markCompositionEnd();
        // Delay setting composing to false to handle Safari's event order
        // In Safari, compositionEnd fires before the ESC keydown event
        setTimeout(() => {
          dialogComposition.setComposing(false);
        }, 100);
        onCompositionEnd?.(e);
      },
    });

    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          "h-11 w-full min-w-0 rounded-2xl border border-border bg-card/60 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground shadow-2xs transition-all outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
