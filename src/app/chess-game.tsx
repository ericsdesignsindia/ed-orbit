"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Crown, Info, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import {
  applyMove,
  createInitialGame,
  FILES,
  formatMove,
  getGameStatus,
  getLegalMoves,
  indexToSquare,
  type Color,
  type GameState,
  type Move,
  type Piece,
  type PieceType,
  PROMOTION_TYPES,
} from "@/lib/chess";

const PIECE_SYMBOLS: Record<Color, Record<PieceType, string>> = {
  white: { king: "♔", queen: "♕", rook: "♖", bishop: "♗", knight: "♘", pawn: "♙" },
  black: { king: "♚", queen: "♛", rook: "♜", bishop: "♝", knight: "♞", pawn: "♟" },
};

const PIECE_NAMES: Record<PieceType, string> = {
  king: "King",
  queen: "Queen",
  rook: "Rook",
  bishop: "Bishop",
  knight: "Knight",
  pawn: "Pawn",
};

const PIECE_VALUES: Record<PieceType, number> = {
  king: 0,
  queen: 9,
  rook: 5,
  bishop: 3,
  knight: 3,
  pawn: 1,
};

type HistoryEntry = {
  state: GameState;
  notation: string;
};

type PromotionChoice = {
  moves: Move[];
  from: number;
  to: number;
};

type MovePair = {
  number: number;
  white?: { notation: string; index: number };
  black?: { notation: string; index: number };
};

function colorName(color: Color): string {
  return color[0].toUpperCase() + color.slice(1);
}

function statusTitle(phase: ReturnType<typeof getGameStatus>["phase"], turn: Color, winner: Color | null): string {
  if (phase === "checkmate") return `${colorName(winner ?? "white")} wins`;
  if (phase === "stalemate") return "Stalemate";
  if (phase === "check") return `${colorName(turn)} is in check`;
  return `${colorName(turn)} to move`;
}

function statusDetail(phase: ReturnType<typeof getGameStatus>["phase"]): string {
  if (phase === "checkmate") return "Checkmate. The king has no legal escape.";
  if (phase === "stalemate") return "No legal moves remain, but neither king is in check.";
  if (phase === "check") return "The king is under attack — answer the check before anything else.";
  return "Select a piece to reveal its legal moves.";
}

function capturedValue(pieces: Piece[]): number {
  return pieces.reduce((total, piece) => total + PIECE_VALUES[piece.type], 0);
}

export default function ChessGame() {
  const [game, setGame] = useState<GameState>(() => createInitialGame());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<Color>("white");
  const [promotionChoice, setPromotionChoice] = useState<PromotionChoice | null>(null);

  const status = useMemo(() => getGameStatus(game), [game]);
  const selectedMoves = useMemo(() => selected === null ? [] : getLegalMoves(game, selected), [game, selected]);
  const legalTargets = useMemo(() => new Set(selectedMoves.map(move => move.to)), [selectedMoves]);
  const displaySquares = useMemo(() => {
    const squares = Array.from({ length: 64 }, (_, index) => index);
    return orientation === "white" ? squares : squares.reverse();
  }, [orientation]);
  const movePairs = useMemo<MovePair[]>(() => {
    const pairs: MovePair[] = [];
    history.forEach((entry, index) => {
      const pairIndex = Math.floor(index / 2);
      if (!pairs[pairIndex]) pairs[pairIndex] = { number: pairIndex + 1 };
      if (index % 2 === 0) pairs[pairIndex].white = { notation: entry.notation, index };
      else pairs[pairIndex].black = { notation: entry.notation, index };
    });
    return pairs;
  }, [history]);

  const capturedByWhite = game.captured.filter(piece => piece.color === "black");
  const capturedByBlack = game.captured.filter(piece => piece.color === "white");
  const isFinished = status.phase === "checkmate" || status.phase === "stalemate";

  function playMove(move: Move) {
    const notation = formatMove(game, move);
    setHistory(previous => [...previous, { state: game, notation }]);
    setGame(applyMove(game, move));
    setSelected(null);
    setPromotionChoice(null);
  }

  function handleSquareClick(square: number) {
    if (isFinished || promotionChoice) return;

    if (selected !== null) {
      const matchingMoves = selectedMoves.filter(move => move.to === square);
      if (matchingMoves.length) {
        if (matchingMoves.some(move => move.promotion)) {
          setPromotionChoice({ moves: matchingMoves, from: selected, to: square });
        } else {
          playMove(matchingMoves[0]);
        }
        return;
      }
    }

    const piece = game.board[square];
    if (piece?.color === game.turn) {
      setSelected(selected === square ? null : square);
    } else {
      setSelected(null);
    }
  }

  function resetGame() {
    setGame(createInitialGame());
    setHistory([]);
    setSelected(null);
    setPromotionChoice(null);
    setOrientation("white");
  }

  function undoMove() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setGame(previous.state);
    setHistory(entries => entries.slice(0, -1));
    setSelected(null);
    setPromotionChoice(null);
  }

  return (
    <main className="chess-app">
      <div className="chess-glow chess-glow-one" />
      <div className="chess-glow chess-glow-two" />
      <header className="chess-header">
        <div className="chess-brand" aria-label="Checkmate chess">
          <span className="brand-mark"><Crown size={17} strokeWidth={2.5} /></span>
          <span>checkmate<span className="brand-punct">.</span></span>
        </div>
        <div className="match-badge"><span className="live-dot" /> Local match</div>
      </header>

      <div className="chess-content">
        <section className="chess-intro">
          <div>
            <p className="chess-eyebrow"><Sparkles size={13} /> Two players · one board</p>
            <h1>Make your <em>move.</em></h1>
            <p className="intro-copy">A focused board for thoughtful games. Every legal move is surfaced, every exchange is remembered.</p>
          </div>
          <div className="intro-note"><span>01</span><p>Classic rules<br /><strong>at your pace</strong></p></div>
        </section>

        <section className="game-layout" aria-label="Chess game">
          <div className="board-column">
            <div className="board-topline">
              <div className="turn-player">
                <span className={`turn-disc ${game.turn}`} />
                <div><span className="micro-label">TO MOVE</span><strong>{colorName(game.turn)}</strong></div>
              </div>
              <div className={`board-status board-status-${status.phase}`} role="status" aria-live="polite">
                <span className="status-pip" />
                {status.phase === "checkmate" ? "Game over" : status.phase === "stalemate" ? "Draw" : status.phase === "check" ? "Check" : "In play"}
              </div>
            </div>

            <div className="board-frame">
              <div className="board" role="grid" aria-label={`Chess board. ${statusTitle(status.phase, game.turn, status.winner)}.`}>
                {displaySquares.map((square, displayIndex) => {
                  const piece = game.board[square];
                  const displayRow = Math.floor(displayIndex / 8);
                  const displayColumn = displayIndex % 8;
                  const row = Math.floor(square / 8);
                  const column = square % 8;
                  const isLight = (row + column) % 2 === 0;
                  const isSelected = selected === square;
                  const isLegalTarget = legalTargets.has(square);
                  const isLastMove = game.lastMove?.from === square || game.lastMove?.to === square;
                  const squareName = indexToSquare(square);
                  const rankLabel = orientation === "white" ? 8 - displayRow : displayRow + 1;
                  const fileLabel = FILES[orientation === "white" ? displayColumn : 7 - displayColumn];
                  const ariaLabel = `${squareName}, ${piece ? `${colorName(piece.color)} ${PIECE_NAMES[piece.type]}` : "empty"}${isLegalTarget ? ", legal move" : ""}`;
                  return (
                    <button
                      type="button"
                      role="gridcell"
                      key={square}
                      className={`square ${isLight ? "square-light" : "square-dark"} ${isSelected ? "square-selected" : ""} ${isLastMove ? "square-last" : ""} ${isLegalTarget ? "square-legal" : ""}`}
                      aria-label={ariaLabel}
                      aria-pressed={isSelected}
                      onClick={() => handleSquareClick(square)}
                    >
                      {displayColumn === 0 && <span className="rank-coordinate">{rankLabel}</span>}
                      {displayRow === 7 && <span className="file-coordinate">{fileLabel}</span>}
                      {isLegalTarget && <span className={`legal-marker ${piece ? "legal-capture" : ""}`} aria-hidden="true" />}
                      {piece && <span className={`piece piece-${piece.color}`} aria-hidden="true">{PIECE_SYMBOLS[piece.color][piece.type]}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="board-footer">
              <div className="board-legend"><span className="legend-dot" /> Legal moves highlighted</div>
              <button type="button" className="text-action" onClick={() => setOrientation(previous => previous === "white" ? "black" : "white")}><ArrowLeftRight size={14} /> Flip board</button>
            </div>
          </div>

          <aside className="game-sidebar">
            <section className={`side-card outcome-card outcome-${status.phase}`}>
              <div className="outcome-icon"><Crown size={21} /></div>
              <div><span className="micro-label">GAME STATUS</span><h2>{statusTitle(status.phase, game.turn, status.winner)}</h2><p>{statusDetail(status.phase)}</p></div>
            </section>

            <section className="side-card history-card">
              <div className="side-card-heading"><div><span className="micro-label">MOVE LOG</span><h2>Match history</h2></div><span className="move-count">{history.length} {history.length === 1 ? "ply" : "plies"}</span></div>
              <div className="move-table" aria-live="polite">
                <div className="move-table-head"><span>#</span><span>WHITE</span><span>BLACK</span></div>
                {movePairs.length === 0 ? <div className="history-empty"><span>♙</span><p>Your opening move<br /><strong>starts the story.</strong></p></div> : movePairs.map(pair => (
                  <div className="move-row" key={pair.number}>
                    <span className="move-number">{String(pair.number).padStart(2, "0")}</span>
                    <span className={pair.white?.index === history.length - 1 ? "latest-move" : ""}>{pair.white?.notation ?? "—"}</span>
                    <span className={pair.black?.index === history.length - 1 ? "latest-move" : ""}>{pair.black?.notation ?? "—"}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="side-card captured-card">
              <div className="side-card-heading"><div><span className="micro-label">MATERIAL</span><h2>Captured pieces</h2></div><span className="move-count">{game.captured.length} total</span></div>
              <div className="captured-row"><span className="captured-side"><i className="mini-disc white" /> White</span><div className="captured-pieces">{capturedByBlack.length ? capturedByBlack.map((piece, index) => <span key={`${piece.type}-${index}`} title={`${PIECE_NAMES[piece.type]} captured`}>{PIECE_SYMBOLS[piece.color][piece.type]}</span>) : <span className="no-captures">—</span>}</div><strong>{capturedValue(capturedByBlack)}</strong></div>
              <div className="captured-row"><span className="captured-side"><i className="mini-disc black" /> Black</span><div className="captured-pieces">{capturedByWhite.length ? capturedByWhite.map((piece, index) => <span key={`${piece.type}-${index}`} title={`${PIECE_NAMES[piece.type]} captured`}>{PIECE_SYMBOLS[piece.color][piece.type]}</span>) : <span className="no-captures">—</span>}</div><strong>{capturedValue(capturedByWhite)}</strong></div>
            </section>

            <section className="side-card controls-card">
              <div className="controls-grid">
                <button type="button" className="control-button control-primary" onClick={resetGame}><RotateCcw size={15} /> New game</button>
                <button type="button" className="control-button" onClick={undoMove} disabled={!history.length}><Undo2 size={15} /> Undo move</button>
              </div>
              <div className="game-tip"><Info size={15} /><p><strong>Quick start</strong> Select a piece, then choose a highlighted square. Promotion choices appear when a pawn reaches the back rank.</p></div>
            </section>
          </aside>
        </section>
      </div>

      {promotionChoice && (
        <div className="promotion-backdrop" role="presentation">
          <section className="promotion-dialog" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
            <span className="micro-label">PAWN PROMOTION</span>
            <h2 id="promotion-title">Choose your piece</h2>
            <p>Give the pawn on {indexToSquare(promotionChoice.to)} a new role.</p>
            <div className="promotion-options">
              {PROMOTION_TYPES.map(type => {
                const move = promotionChoice.moves.find(candidate => candidate.promotion === type);
                if (!move) return null;
                return <button type="button" className="promotion-option" key={type} onClick={() => playMove(move)}><span className={`piece piece-${game.turn}`}>{PIECE_SYMBOLS[game.turn][type]}</span><span>{PIECE_NAMES[type]}</span></button>;
              })}
            </div>
            <button type="button" className="promotion-cancel" onClick={() => setPromotionChoice(null)}>Cancel</button>
          </section>
        </div>
      )}
    </main>
  );
}
