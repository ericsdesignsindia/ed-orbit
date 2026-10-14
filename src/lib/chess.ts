export type Color = "white" | "black";
export type PieceType = "king" | "queen" | "rook" | "bishop" | "knight" | "pawn";
export type PromotionType = Exclude<PieceType, "king" | "pawn">;

export interface Piece {
  type: PieceType;
  color: Color;
}

export type Board = Array<Piece | null>;

export interface CastlingRights {
  white: { kingside: boolean; queenside: boolean };
  black: { kingside: boolean; queenside: boolean };
}

export interface Move {
  from: number;
  to: number;
  promotion?: PromotionType;
  castle?: "kingside" | "queenside";
  enPassant?: boolean;
}

export interface GameState {
  board: Board;
  turn: Color;
  castling: CastlingRights;
  enPassant: number | null;
  lastMove: Move | null;
  captured: Piece[];
  moveNumber: number;
}

export type GamePhase = "playing" | "check" | "checkmate" | "stalemate";

export interface GameStatus {
  phase: GamePhase;
  inCheck: boolean;
  winner: Color | null;
  legalMoves: Move[];
}

export const PROMOTION_TYPES: PromotionType[] = ["queen", "rook", "bishop", "knight"];
export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

const BACK_RANK: PieceType[] = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"];

export function opposite(color: Color): Color {
  return color === "white" ? "black" : "white";
}

export function squareToIndex(square: string): number {
  if (!/^[a-h][1-8]$/.test(square)) return -1;
  const file = FILES.indexOf(square[0] as typeof FILES[number]);
  const rank = Number(square[1]);
  return (8 - rank) * 8 + file;
}

export function indexToSquare(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 64) return "";
  return `${FILES[index % 8]}${8 - Math.floor(index / 8)}`;
}

function indexAt(row: number, column: number): number {
  return row * 8 + column;
}

function inBounds(row: number, column: number): boolean {
  return row >= 0 && row < 8 && column >= 0 && column < 8;
}

function createPiece(type: PieceType, color: Color): Piece {
  return { type, color };
}

function cloneCastlingRights(castling: CastlingRights): CastlingRights {
  return {
    white: { ...castling.white },
    black: { ...castling.black },
  };
}

export function createInitialBoard(): Board {
  const board: Board = Array.from({ length: 64 }, () => null);
  BACK_RANK.forEach((type, column) => {
    board[column] = createPiece(type, "black");
    board[56 + column] = createPiece(type, "white");
  });
  for (let column = 0; column < 8; column += 1) {
    board[8 + column] = createPiece("pawn", "black");
    board[48 + column] = createPiece("pawn", "white");
  }
  return board;
}

export function createInitialGame(): GameState {
  return {
    board: createInitialBoard(),
    turn: "white",
    castling: {
      white: { kingside: true, queenside: true },
      black: { kingside: true, queenside: true },
    },
    enPassant: null,
    lastMove: null,
    captured: [],
    moveNumber: 1,
  };
}

function findKing(board: Board, color: Color): number {
  return board.findIndex(piece => piece?.type === "king" && piece.color === color);
}

export function isSquareAttacked(board: Board, square: number, byColor: Color): boolean {
  if (square < 0 || square >= 64) return false;
  const row = Math.floor(square / 8);
  const column = square % 8;

  const pawnRow = row + (byColor === "white" ? 1 : -1);
  for (const pawnColumn of [column - 1, column + 1]) {
    if (!inBounds(pawnRow, pawnColumn)) continue;
    const piece = board[indexAt(pawnRow, pawnColumn)];
    if (piece?.color === byColor && piece.type === "pawn") return true;
  }

  const knightOffsets = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ] as const;
  for (const [rowOffset, columnOffset] of knightOffsets) {
    const candidateRow = row + rowOffset;
    const candidateColumn = column + columnOffset;
    if (!inBounds(candidateRow, candidateColumn)) continue;
    const piece = board[indexAt(candidateRow, candidateColumn)];
    if (piece?.color === byColor && piece.type === "knight") return true;
  }

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      if (!rowOffset && !columnOffset) continue;
      const candidateRow = row + rowOffset;
      const candidateColumn = column + columnOffset;
      if (!inBounds(candidateRow, candidateColumn)) continue;
      const piece = board[indexAt(candidateRow, candidateColumn)];
      if (piece?.color === byColor && piece.type === "king") return true;
    }
  }

  const orthogonal = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (const [rowOffset, columnOffset] of orthogonal) {
    let candidateRow = row + rowOffset;
    let candidateColumn = column + columnOffset;
    while (inBounds(candidateRow, candidateColumn)) {
      const piece = board[indexAt(candidateRow, candidateColumn)];
      if (piece) {
        if (piece.color === byColor && (piece.type === "rook" || piece.type === "queen")) return true;
        break;
      }
      candidateRow += rowOffset;
      candidateColumn += columnOffset;
    }
  }

  const diagonal = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
  for (const [rowOffset, columnOffset] of diagonal) {
    let candidateRow = row + rowOffset;
    let candidateColumn = column + columnOffset;
    while (inBounds(candidateRow, candidateColumn)) {
      const piece = board[indexAt(candidateRow, candidateColumn)];
      if (piece) {
        if (piece.color === byColor && (piece.type === "bishop" || piece.type === "queen")) return true;
        break;
      }
      candidateRow += rowOffset;
      candidateColumn += columnOffset;
    }
  }

  return false;
}

export function isInCheck(state: GameState, color: Color): boolean {
  const king = findKing(state.board, color);
  return king >= 0 && isSquareAttacked(state.board, king, opposite(color));
}

function pushSlidingMoves(
  state: GameState,
  from: number,
  piece: Piece,
  directions: ReadonlyArray<readonly [number, number]>,
  moves: Move[],
): void {
  const row = Math.floor(from / 8);
  const column = from % 8;
  for (const [rowOffset, columnOffset] of directions) {
    let candidateRow = row + rowOffset;
    let candidateColumn = column + columnOffset;
    while (inBounds(candidateRow, candidateColumn)) {
      const to = indexAt(candidateRow, candidateColumn);
      const target = state.board[to];
      if (!target) {
        moves.push({ from, to });
      } else {
        if (target.color !== piece.color && target.type !== "king") moves.push({ from, to });
        break;
      }
      candidateRow += rowOffset;
      candidateColumn += columnOffset;
    }
  }
}

function addPawnMove(moves: Move[], from: number, to: number, color: Color, enPassant = false): void {
  const destinationRow = Math.floor(to / 8);
  const promotionRow = color === "white" ? 0 : 7;
  if (destinationRow === promotionRow) {
    for (const promotion of PROMOTION_TYPES) moves.push({ from, to, promotion, ...(enPassant ? { enPassant } : {}) });
  } else {
    moves.push({ from, to, ...(enPassant ? { enPassant } : {}) });
  }
}

function addKingCastlingMoves(state: GameState, from: number, piece: Piece, moves: Move[]): void {
  const homeRow = piece.color === "white" ? 7 : 0;
  const homeKing = indexAt(homeRow, 4);
  if (from !== homeKing || isInCheck(state, piece.color)) return;

  const enemy = opposite(piece.color);
  const rights = state.castling[piece.color];
  const kingSideRook = state.board[indexAt(homeRow, 7)];
  if (
    rights.kingside &&
    kingSideRook?.type === "rook" &&
    kingSideRook.color === piece.color &&
    state.board[indexAt(homeRow, 5)] === null &&
    state.board[indexAt(homeRow, 6)] === null &&
    !isSquareAttacked(state.board, indexAt(homeRow, 5), enemy) &&
    !isSquareAttacked(state.board, indexAt(homeRow, 6), enemy)
  ) {
    moves.push({ from, to: indexAt(homeRow, 6), castle: "kingside" });
  }

  const queenSideRook = state.board[indexAt(homeRow, 0)];
  if (
    rights.queenside &&
    queenSideRook?.type === "rook" &&
    queenSideRook.color === piece.color &&
    state.board[indexAt(homeRow, 1)] === null &&
    state.board[indexAt(homeRow, 2)] === null &&
    state.board[indexAt(homeRow, 3)] === null &&
    !isSquareAttacked(state.board, indexAt(homeRow, 3), enemy) &&
    !isSquareAttacked(state.board, indexAt(homeRow, 2), enemy)
  ) {
    moves.push({ from, to: indexAt(homeRow, 2), castle: "queenside" });
  }
}

export function getPseudoMoves(state: GameState, from: number): Move[] {
  const piece = state.board[from];
  if (!piece || from < 0 || from >= 64) return [];

  const moves: Move[] = [];
  const row = Math.floor(from / 8);
  const column = from % 8;

  if (piece.type === "pawn") {
    const direction = piece.color === "white" ? -1 : 1;
    const startingRow = piece.color === "white" ? 6 : 1;
    const oneRow = row + direction;
    if (inBounds(oneRow, column)) {
      const oneStep = indexAt(oneRow, column);
      if (state.board[oneStep] === null) {
        addPawnMove(moves, from, oneStep, piece.color);
        const twoRow = row + direction * 2;
        const twoStep = indexAt(twoRow, column);
        if (row === startingRow && state.board[twoStep] === null) moves.push({ from, to: twoStep });
      }
      for (const captureColumn of [column - 1, column + 1]) {
        if (!inBounds(oneRow, captureColumn)) continue;
        const target = indexAt(oneRow, captureColumn);
        const targetPiece = state.board[target];
        if (targetPiece && targetPiece.color !== piece.color && targetPiece.type !== "king") {
          addPawnMove(moves, from, target, piece.color);
        } else if (state.enPassant === target) {
          const capturedIndex = target - direction * 8;
          const captured = state.board[capturedIndex];
          if (captured?.type === "pawn" && captured.color !== piece.color) addPawnMove(moves, from, target, piece.color, true);
        }
      }
    }
  }

  if (piece.type === "knight") {
    const offsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1],
    ] as const;
    for (const [rowOffset, columnOffset] of offsets) {
      const candidateRow = row + rowOffset;
      const candidateColumn = column + columnOffset;
      if (!inBounds(candidateRow, candidateColumn)) continue;
      const target = state.board[indexAt(candidateRow, candidateColumn)];
      if (!target || (target.color !== piece.color && target.type !== "king")) moves.push({ from, to: indexAt(candidateRow, candidateColumn) });
    }
  }

  if (piece.type === "bishop" || piece.type === "queen") {
    pushSlidingMoves(state, from, piece, [[1, 1], [1, -1], [-1, 1], [-1, -1]], moves);
  }
  if (piece.type === "rook" || piece.type === "queen") {
    pushSlidingMoves(state, from, piece, [[1, 0], [-1, 0], [0, 1], [0, -1]], moves);
  }

  if (piece.type === "king") {
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if (!rowOffset && !columnOffset) continue;
        const candidateRow = row + rowOffset;
        const candidateColumn = column + columnOffset;
        if (!inBounds(candidateRow, candidateColumn)) continue;
        const target = state.board[indexAt(candidateRow, candidateColumn)];
        if (!target || (target.color !== piece.color && target.type !== "king")) moves.push({ from, to: indexAt(candidateRow, candidateColumn) });
      }
    }
    addKingCastlingMoves(state, from, piece, moves);
  }

  return moves;
}

function getLegalMovesForPiece(state: GameState, from: number): Move[] {
  const piece = state.board[from];
  if (!piece) return [];
  return getPseudoMoves(state, from).filter(move => !isInCheck(applyMove(state, move), piece.color));
}

export function getLegalMoves(state: GameState, from: number): Move[] {
  const piece = state.board[from];
  if (!piece || piece.color !== state.turn) return [];
  return getLegalMovesForPiece(state, from);
}

export function getAllLegalMoves(state: GameState, color: Color = state.turn): Move[] {
  const moves: Move[] = [];
  state.board.forEach((piece, index) => {
    if (piece?.color === color) moves.push(...getLegalMovesForPiece(state, index));
  });
  return moves;
}

function revokeRookRight(castling: CastlingRights, color: Color, square: number): void {
  const homeRow = color === "white" ? 7 : 0;
  if (square === indexAt(homeRow, 0)) castling[color].queenside = false;
  if (square === indexAt(homeRow, 7)) castling[color].kingside = false;
}

export function applyMove(state: GameState, move: Move): GameState {
  const movingPiece = state.board[move.from];
  if (!movingPiece) throw new Error("Cannot move from an empty square.");
  const targetPiece = state.board[move.to];
  if (targetPiece?.color === movingPiece.color) throw new Error("Cannot capture a piece of the same color.");

  const board = [...state.board];
  const castling = cloneCastlingRights(state.castling);
  const captured = [...state.captured];
  let capturedIndex = move.to;
  let capturedPiece = targetPiece;

  if (move.enPassant) {
    capturedIndex = move.to - (movingPiece.color === "white" ? -8 : 8);
    capturedPiece = board[capturedIndex];
    board[capturedIndex] = null;
  }
  if (capturedPiece) captured.push(capturedPiece);

  board[move.from] = null;
  board[move.to] = move.promotion ? createPiece(move.promotion, movingPiece.color) : createPiece(movingPiece.type, movingPiece.color);

  if (move.castle) {
    const homeRow = movingPiece.color === "white" ? 7 : 0;
    const rookFrom = indexAt(homeRow, move.castle === "kingside" ? 7 : 0);
    const rookTo = indexAt(homeRow, move.castle === "kingside" ? 5 : 3);
    const rook = board[rookFrom];
    board[rookFrom] = null;
    if (rook) board[rookTo] = createPiece("rook", rook.color);
  }

  if (movingPiece.type === "king") {
    castling[movingPiece.color] = { kingside: false, queenside: false };
  }
  if (movingPiece.type === "rook") revokeRookRight(castling, movingPiece.color, move.from);
  if (capturedPiece?.type === "rook") revokeRookRight(castling, capturedPiece.color, capturedIndex);

  const next: GameState = {
    board,
    turn: opposite(state.turn),
    castling,
    enPassant: null,
    lastMove: { ...move },
    captured,
    moveNumber: state.moveNumber + (movingPiece.color === "black" ? 1 : 0),
  };
  if (movingPiece.type === "pawn" && Math.abs(move.to - move.from) === 16) next.enPassant = (move.to + move.from) / 2;
  return next;
}

export function getGameStatus(state: GameState): GameStatus {
  const inCheck = isInCheck(state, state.turn);
  const legalMoves = getAllLegalMoves(state, state.turn);
  if (!legalMoves.length) {
    return {
      phase: inCheck ? "checkmate" : "stalemate",
      inCheck,
      winner: inCheck ? opposite(state.turn) : null,
      legalMoves,
    };
  }
  return { phase: inCheck ? "check" : "playing", inCheck, winner: null, legalMoves };
}

const PIECE_LETTERS: Record<PieceType, string> = {
  king: "K",
  queen: "Q",
  rook: "R",
  bishop: "B",
  knight: "N",
  pawn: "",
};

function moveSuffix(state: GameState, move: Move): string {
  const next = applyMove(state, move);
  const status = getGameStatus(next);
  return status.phase === "checkmate" ? "#" : status.inCheck ? "+" : "";
}

export function formatMove(state: GameState, move: Move): string {
  const piece = state.board[move.from];
  if (!piece) return indexToSquare(move.to);
  if (move.castle === "kingside") return `O-O${moveSuffix(state, move)}`;
  if (move.castle === "queenside") return `O-O-O${moveSuffix(state, move)}`;

  const target = state.board[move.to];
  const capture = !!target || !!move.enPassant;
  let notation = PIECE_LETTERS[piece.type];
  if (piece.type !== "pawn") {
    const contenders = getAllLegalMoves(state).filter(candidate => {
      if (candidate.from === move.from || candidate.to !== move.to) return false;
      const candidatePiece = state.board[candidate.from];
      return candidatePiece?.color === piece.color && candidatePiece.type === piece.type;
    });
    if (contenders.length) {
      const sameFile = contenders.some(candidate => candidate.from % 8 === move.from % 8);
      const sameRank = contenders.some(candidate => Math.floor(candidate.from / 8) === Math.floor(move.from / 8));
      if (!sameFile) notation += FILES[move.from % 8];
      else if (!sameRank) notation += String(8 - Math.floor(move.from / 8));
      else notation += indexToSquare(move.from);
    }
  } else if (capture) {
    notation += FILES[move.from % 8];
  }
  if (capture) notation += "x";
  notation += indexToSquare(move.to);
  if (move.promotion) notation += `=${PIECE_LETTERS[move.promotion]}`;
  return `${notation}${moveSuffix(state, move)}`;
}
