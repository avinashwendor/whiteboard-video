import { BOARDS, boardOf, type Board, type BoardFormat } from "@/lib/whiteboard/scene";

/**
 * The frame the current paint is going into.
 *
 * Module state, deliberately, and this is the one place in the codebase where
 * that is the right answer. Hyperframes is a hundred and sixty drawing helpers
 * — a rule, a pill, an eyebrow, a wrapped headline — that each need to know how
 * big the frame is and nothing else about it. Threading a parameter through all
 * of them would put the same argument in every signature in the module and
 * change nothing about what any of them does.
 *
 * It is safe because painting is what it is: one frame at a time, synchronous
 * from `setFrame` to the last stroke, on one thread. There is no point at which
 * two frames of different shapes are in flight.
 *
 * The whiteboard style does not work this way — its layouts are *composed* as
 * geometry before anything is painted, so they take a board and return
 * different arrangements for different shapes. Kinetic type has no such
 * arrangement to change: a headline is centred in whatever frame it is in, and
 * what actually varies is how wide a line may run and where the bottom is.
 */
let current: Board = BOARDS.landscape;

export function setFrame(board: Board | BoardFormat | undefined): void {
  current = typeof board === "string" ? boardOf(board) : (board ?? BOARDS.landscape);
}

export function frame(): Board {
  return current;
}

export function frameW(): number {
  return current.width;
}

export function frameH(): number {
  return current.height;
}
