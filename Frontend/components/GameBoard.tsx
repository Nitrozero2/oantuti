"use client";

export type Piece = { player: number; type: string } | null;

const COLS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

export const PIECE_EMOJI: Record<string, string> = {
  ROCK: "✊",
  PAPER: "✋",
  SCISSORS: "✌️",
};

const PIECE_LABEL: Record<string, string> = {
  ROCK: "ĐẤM",
  PAPER: "LÁ",
  SCISSORS: "KÉO",
};

function PieceToken({ piece, size }: { piece: NonNullable<Piece>; size: number }) {
  const isP1 = piece.player === 1;

  // Colors matching the screenshot: P1=blue gradient, P2=red gradient
  const bg = isP1
    ? "radial-gradient(circle at 35% 35%, #60c8ff, #1a7fc4 60%, #0d5a99)"
    : "radial-gradient(circle at 35% 35%, #ff8a8a, #d43030 60%, #9b1515)";

  const borderColor = isP1 ? "#7dd8ff" : "#ff9999";
  const labelColor  = isP1 ? "#ffe066" : "#ffe066";

  const emojiSize  = Math.round(size * 0.42);
  const labelSize  = Math.round(size * 0.18);
  const borderPx   = Math.max(1, Math.round(size * 0.06));

  return (
    <div
      style={{
        width:  size,
        height: size,
        borderRadius: "50%",
        background: bg,
        border: `${borderPx}px solid ${borderColor}`,
        boxShadow: isP1
          ? "0 2px 6px rgba(0,100,200,0.5), inset 0 1px 2px rgba(255,255,255,0.3)"
          : "0 2px 6px rgba(180,0,0,0.5), inset 0 1px 2px rgba(255,255,255,0.3)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        position: "relative",
        cursor: "default",
        userSelect: "none",
        flexShrink: 0,
      }}
      title={`P${piece.player} ${piece.type}`}
    >
      <span style={{ fontSize: emojiSize, lineHeight: 1, marginTop: 1 }}>
        {PIECE_EMOJI[piece.type]}
      </span>
      <span style={{
        fontSize: labelSize,
        lineHeight: 1,
        color: labelColor,
        fontWeight: 700,
        fontFamily: "monospace",
        letterSpacing: "0.02em",
        marginTop: 1,
      }}>
        {PIECE_LABEL[piece.type]}
      </span>
    </div>
  );
}

function BoardCell({
  piece,
  col,
  row,
  isLastFrom,
  isLastTo,
  cellSize,
}: {
  piece: Piece;
  col: number;
  row: number;
  isLastFrom: boolean;
  isLastTo: boolean;
  cellSize: number;
}) {
  // Checkerboard pattern: (col + row) % 2
  const isLight = (col + row) % 2 === 0;

  // Base cell color
  let bg = isLight
    ? "rgba(255,255,255,0.07)"
    : "rgba(0,0,0,0.25)";

  // Last move highlight
  if (isLastFrom) bg = "rgba(100,160,255,0.25)";
  if (isLastTo)   bg = "rgba(80,220,120,0.25)";

  // Target cells: i9 (col=8,row=8) and a1 (col=0,row=0)
  const isBase = (col === 8 && row === 8) || (col === 0 && row === 0);
  const isP1base = col === 8 && row === 8; // i9 = P1 target
  const isP2base = col === 0 && row === 0; // a1 = P2 target

  const baseBorderColor = isP1base
    ? "rgba(100,200,255,0.7)"
    : isP2base
    ? "rgba(255,100,100,0.7)"
    : "transparent";

  const pieceSize = Math.round(cellSize * 0.78);

  return (
    <div
      style={{
        width:  cellSize,
        height: cellSize,
        background: bg,
        border: isBase
          ? `2px dashed ${baseBorderColor}`
          : `1px solid rgba(255,255,255,0.04)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        boxSizing: "border-box",
        flexShrink: 0,
      }}
    >
      {/* Star icon for base cells */}
      {isBase && !piece && (
        <span style={{
          fontSize: cellSize * 0.22,
          opacity: 0.5,
          color: isP1base ? "#7dd8ff" : "#ff9999",
          position: "absolute",
          top: 2,
          right: 3,
        }}>★</span>
      )}
      {/* Base label */}
      {isBase && !piece && (
        <span style={{
          fontSize: cellSize * 0.18,
          color: isP1base ? "#7dd8ff" : "#ff9999",
          fontFamily: "monospace",
          fontWeight: 700,
          opacity: 0.7,
          position: "absolute",
          bottom: 2,
          left: 3,
        }}>
          {isP1base ? "i9" : "a1"}
        </span>
      )}
      {piece && <PieceToken piece={piece} size={pieceSize} />}
    </div>
  );
}

export function GameBoard({
  board,
  lastMove,
}: {
  board: Piece[];
  lastMove?: { from_col: number; from_row: number; to_col: number; to_row: number } | null;
}) {
  // Responsive cell size via CSS variable trick — use inline style on container
  const CELL = 56; // base px, will scale via transform

  const totalW = CELL * 9;
  const labelW = 20;
  const totalH = CELL * 9;

  return (
    <div
      className="w-full overflow-x-auto"
      style={{ userSelect: "none" }}
    >
      <div style={{ display: "inline-block", minWidth: totalW + labelW * 2 }}>
        {/* Top column labels */}
        <div style={{ display: "flex", marginLeft: labelW }}>
          {COLS.map(c => (
            <div key={c} style={{
              width: CELL, textAlign: "center",
              fontSize: 11, color: "#94a3b8",
              fontFamily: "monospace", fontWeight: 600,
              paddingBottom: 3,
            }}>{c}</div>
          ))}
        </div>

        {/* Board rows — row 9 at top, row 1 at bottom */}
        {Array.from({ length: 9 }, (_, i) => 8 - i).map(row => (
          <div key={row} style={{ display: "flex", alignItems: "center" }}>
            {/* Left row label */}
            <div style={{
              width: labelW, textAlign: "right", paddingRight: 4,
              fontSize: 11, color: "#94a3b8",
              fontFamily: "monospace", fontWeight: 600,
              flexShrink: 0,
            }}>{row + 1}</div>

            {/* Cells */}
            {Array.from({ length: 9 }, (_, col) => {
              const idx = row * 9 + col;
              return (
                <BoardCell
                  key={col}
                  piece={board[idx] ?? null}
                  col={col}
                  row={row}
                  isLastFrom={lastMove?.from_col === col && lastMove?.from_row === row}
                  isLastTo={lastMove?.to_col === col && lastMove?.to_row === row}
                  cellSize={CELL}
                />
              );
            })}

            {/* Right row label */}
            <div style={{
              width: labelW, textAlign: "left", paddingLeft: 4,
              fontSize: 11, color: "#94a3b8",
              fontFamily: "monospace", fontWeight: 600,
              flexShrink: 0,
            }}>{row + 1}</div>
          </div>
        ))}

        {/* Bottom column labels */}
        <div style={{ display: "flex", marginLeft: labelW }}>
          {COLS.map(c => (
            <div key={c} style={{
              width: CELL, textAlign: "center",
              fontSize: 11, color: "#94a3b8",
              fontFamily: "monospace", fontWeight: 600,
              paddingTop: 3,
            }}>{c}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Reconstruct board state by replaying moves from initial board */
export function applyMove(
  board: Piece[],
  move: { from_col: number; from_row: number; to_col: number; to_row: number },
): Piece[] {
  const next = [...board];
  const fromIdx = move.from_row * 9 + move.from_col;
  const toIdx   = move.to_row   * 9 + move.to_col;
  next[toIdx]   = next[fromIdx];
  next[fromIdx] = null;
  return next;
}

/** Convert 2D initial board to flat array */
export function flattenBoard(board2d: Piece[][]): Piece[] {
  const flat: Piece[] = Array(81).fill(null);
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      flat[r * 9 + c] = board2d[r]?.[c] ?? null;
  return flat;
}

export function getPieceCounts(board: Piece[]): Record<number, Record<string, number>> {
  const counts: Record<number, Record<string, number>> = {
    1: { ROCK: 0, PAPER: 0, SCISSORS: 0 },
    2: { ROCK: 0, PAPER: 0, SCISSORS: 0 },
  };
  for (const p of board) {
    if (p) counts[p.player][p.type]++;
  }
  return counts;
}
