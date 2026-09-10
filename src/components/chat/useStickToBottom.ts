import { useCallback, useEffect, useRef, useState } from "react"

const THRESHOLD_PX = 48

/**
 * Pins a scroll container to its bottom while content grows, unless the user
 * has scrolled up. Attach `scrollRef` to the scrolling element and
 * `contentRef` to the element whose size changes.
 */
export function useStickToBottom() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current
    if (!el) return
    pinned.current = true
    setIsAtBottom(true)
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      const atBottom = distance <= THRESHOLD_PX
      pinned.current = atBottom
      setIsAtBottom(atBottom)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  return { scrollRef, contentRef, isAtBottom, scrollToBottom }
}
