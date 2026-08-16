// Pull the jest-dom matcher augmentation (`toBeInTheDocument`, …) into the typecheck program so the
// component smoke tests type-check. The runtime registration happens in `vitest.setup.ts`.
import "@testing-library/jest-dom/vitest";
