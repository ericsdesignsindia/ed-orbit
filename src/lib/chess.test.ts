import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMove,
  createInitialGame,
  formatMove,
  getAllLegalMoves,
  getGameStatus,
  getLegalMoves,
  squareToIndex,
  type GameState,
  type Piece,
} from "./chess";

function play(state: GameState, from: string, to: string, promotion?: "queen" | "rook" | "bishop" | "knight"): GameState {
  const fromIndex = squareToIndex(from);
  const toIndex = squareToIndex(to);
  const move = getLegalMoves(state, fromIndex).find(candidate => candidate.to === toIndex && candidate.promotion === promotion);
  assert.ok(move, `Expected ${from} → ${to} to be legal`);
  return applyMove(state, move);
}

function customState(board: Array<Piece | null>, turn: "white" | "black" = "white"): GameState {
  return {
    board,
    turn,
    castling: { white: { kingside: false, queenside: false }, black: { kingside: false, queenside: false } },
    enPassant: null,
    lastMove: null,
    captured: [],
    moveNumber: 1,
  };
}

test("starts with the standard position and twenty legal moves", () => {
  const state = createInitialGame();
  assert.equal(getAllLegalMoves(state).length, 20);
  assert.equal(getLegalMoves(state, squareToIndex("e2")).length, 2);
  assert.equal(state.board[squareToIndex("e1")]?.type, "king");
  assert.equal(state.board[squareToIndex("a8")]?.color, "black");
});

test("recognizes checkmate in the classic four-move trap", () => {
  let state = createInitialGame();
  state = play(state, "f2", "f3");
  state = play(state, "e7", "e5");
  state = play(state, "g2", "g4");
  const move = getLegalMoves(state, squareToIndex("d8")).find(candidate => candidate.to === squareToIndex("h4"));
  assert.ok(move);
  assert.equal(formatMove(state, move), "Qh4#");
  state = applyMove(state, move);
  const status = getGameStatus(state);
  assert.equal(status.phase, "checkmate");
  assert.equal(status.winner, "black");
  assert.equal(status.legalMoves.length, 0);
});

test("allows castling only through safe squares and moves the rook", () => {
  let state = createInitialGame();
  state = play(state, "e2", "e4");
  state = play(state, "e7", "e5");
  state = play(state, "g1", "f3");
  state = play(state, "g8", "f6");
  state = play(state, "f1", "e2");
  state = play(state, "b8", "c6");
  state = play(state, "d2", "d3");
  state = play(state, "a7", "a6");
  const castle = getLegalMoves(state, squareToIndex("e1")).find(candidate => candidate.castle === "kingside");
  assert.ok(castle);
  assert.equal(formatMove(state, castle), "O-O");
  state = applyMove(state, castle);
  assert.equal(state.board[squareToIndex("g1")]?.type, "king");
  assert.equal(state.board[squareToIndex("f1")]?.type, "rook");
  assert.equal(state.castling.white.kingside, false);
});

test("supports en passant after a two-square pawn move", () => {
  let state = createInitialGame();
  state = play(state, "e2", "e4");
  state = play(state, "a7", "a6");
  state = play(state, "e4", "e5");
  state = play(state, "d7", "d5");
  const enPassant = getLegalMoves(state, squareToIndex("e5")).find(candidate => candidate.to === squareToIndex("d6"));
  assert.ok(enPassant?.enPassant);
  state = applyMove(state, enPassant);
  assert.equal(state.board[squareToIndex("d6")]?.color, "white");
  assert.equal(state.board[squareToIndex("d5")], null);
  assert.equal(state.captured[0]?.type, "pawn");
});

test("offers all four promotion choices and prevents a pinned piece from exposing its king", () => {
  const board: Array<Piece | null> = Array.from({ length: 64 }, () => null);
  board[squareToIndex("e1")] = { type: "king", color: "white" };
  board[squareToIndex("e8")] = { type: "king", color: "black" };
  board[squareToIndex("a7")] = { type: "pawn", color: "white" };
  board[squareToIndex("e2")] = { type: "rook", color: "white" };
  board[squareToIndex("e7")] = { type: "rook", color: "black" };
  const state = customState(board);
  const promotions = getLegalMoves(state, squareToIndex("a7"));
  assert.deepEqual(promotions.map(move => move.promotion), ["queen", "rook", "bishop", "knight"]);
  const pinnedMoves = getLegalMoves(state, squareToIndex("e2"));
  assert.ok(pinnedMoves.every(move => move.to % 8 === squareToIndex("e2") % 8));
});
