import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface Props {
  /** 行内的触发器图标 */
  trigger: ReactNode;
  /** popup 内容（Card 等），通过 portal 挂载到 body */
  content: ReactNode;
  /** popup 的宽度约束等样式（如 "w-80 max-w-md"） */
  className?: string;
}

const GAP = 8;

/** 真正的悬浮 popup：portal 到 body + fixed 定位。
 *  不参与文档流、不受列表滚动容器裁剪/撑开；悬停触发器或 popup 内容均保持打开，
 *  滚动 popup 自身内容不会导致关闭。 */
export default function HoverPopover({ trigger, content, className }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const close = useCallback(() => setOpen(false), []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  /** 离开触发器后延迟关闭：给鼠标留出跨越间隙进入 popup 的时间。 */
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(close, 100);
  }, [cancelClose, close]);

  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popH = popRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + GAP + popH <= window.innerHeight;
    setPos({
      top: below ? rect.bottom + GAP : Math.max(GAP, rect.top - popH - GAP),
      right: Math.max(GAP, window.innerWidth - rect.right),
    });
  }, []);

  /** 进入触发器：先按图标位置定位（避免 popup 挂载后闪一下），再打开。 */
  const openAt = useCallback(() => {
    const el = triggerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPos({
        top: rect.bottom + GAP,
        right: Math.max(GAP, window.innerWidth - rect.right),
      });
    }
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  /** 打开后按实际内容高度校正位置（下方放不下时翻转到上方）、窗口尺寸变化跟随、外部滚动收起。 */
  const handleScroll = useCallback(
    (e: Event) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return; // 滚动 popup 自身内容不关闭
      close();
    },
    [close]
  );

  useEffect(() => {
    if (!open) return;
    updatePos();
    const raf = requestAnimationFrame(updatePos);
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, updatePos, handleScroll]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  return (
    <>
      <span
        ref={triggerRef}
        className="relative inline-flex"
        onMouseEnter={openAt}
        onMouseLeave={scheduleClose}
      >
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className={cn("fixed z-50", className)}
            style={pos ? { top: pos.top, right: pos.right } : undefined}
            onMouseEnter={cancelClose}
            onMouseLeave={close}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
