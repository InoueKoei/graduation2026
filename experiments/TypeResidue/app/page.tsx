"use client";

import { useCallback, useRef, useState } from "react";

type FallingWord = {
  id: number;
  text: string;
  x: number;
  y: number;
  burstX: number;
  driftX: number;
  fallDistance: number;
  rotation: number;
  duration: number;
};

function commonEdges(before: string, after: string) {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return { prefix, suffix };
}

export default function Home() {
  const [draft, setDraft] = useState("");
  const [fallingWords, setFallingWords] = useState<FallingWord[]>([]);
  const previousValue = useRef("");
  const isComposing = useRef(false);
  const nextId = useRef(1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dropWord = useCallback((text: string, caretIndex: number) => {
    const textarea = textareaRef.current;
    if (!textarea || !text) return;

    const rect = textarea.getBoundingClientRect();
    const computed = window.getComputedStyle(textarea);
    const fontSize = Number.parseFloat(computed.fontSize) || 52;
    const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.55;
    const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const beforeCaret = textarea.value.slice(0, caretIndex);
    const lines = beforeCaret.split("\n");
    const line = lines.length - 1;
    const column = lines.at(-1)?.length ?? 0;
    const usableWidth = Math.max(120, rect.width - paddingLeft * 2);
    const estimatedX =
      rect.left + paddingLeft + ((column * fontSize * 0.94) % usableWidth);
    const estimatedY = rect.top + paddingTop + line * lineHeight + fontSize * 0.7;
    const x = Math.min(rect.right - 24, Math.max(rect.left + 24, estimatedX));
    const y = Math.min(rect.bottom - 24, estimatedY);
    const id = nextId.current++;
    const burstX = (Math.random() - 0.5) * 90;
    const driftX = (Math.random() - 0.5) * Math.min(window.innerWidth * 0.55, 520);
    const landingY = window.innerHeight - 54 - ((id - 1) % 5) * 7;

    setFallingWords((current) => [
      ...current.slice(-79),
      {
        id,
        text,
        x,
        y,
        burstX,
        driftX,
        fallDistance: Math.max(80, landingY - y),
        rotation: (Math.random() - 0.5) * 24,
        duration: 2.2 + Math.random() * 0.75,
      },
    ]);
  }, []);

  const recordChange = useCallback(
    (next: string, caretIndex: number) => {
      const before = previousValue.current;
      if (before === next) return;

      const { prefix, suffix } = commonEdges(before, next);
      const removed = before.slice(prefix, before.length - suffix);

      if (removed) dropWord(removed, caretIndex);
      previousValue.current = next;
    },
    [dropWord],
  );

  const handleChange = (element: HTMLTextAreaElement) => {
    const next = element.value;
    setDraft(next);
    if (!isComposing.current) {
      recordChange(next, element.selectionStart ?? next.length);
    }
  };

  return (
    <main>
      <header>
        <h1>消さない組版</h1>
        <p>TYPE RESIDUE / 01</p>
      </header>

      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => handleChange(event.currentTarget)}
        onCompositionStart={() => {
          isComposing.current = true;
        }}
        onCompositionEnd={(event) => {
          isComposing.current = false;
          const element = event.currentTarget;
          setDraft(element.value);
          recordChange(
            element.value,
            element.selectionStart ?? element.value.length,
          );
        }}
        placeholder="ここに入力"
        aria-label="文章を入力"
        spellCheck={false}
        autoFocus
      />

      <div className="falling-layer" aria-live="polite">
        {fallingWords.map((word) => (
          <span
            className="falling-word"
            key={word.id}
            style={
              {
                "--start-x": `${word.x}px`,
                "--start-y": `${word.y}px`,
                "--burst-x": `${word.burstX}px`,
                "--drift-x": `${word.driftX}px`,
                "--fall-distance": `${word.fallDistance}px`,
                "--rotation": `${word.rotation}deg`,
                "--duration": `${word.duration}s`,
              } as React.CSSProperties
            }
          >
            {word.text}
          </span>
        ))}
      </div>
    </main>
  );
}
