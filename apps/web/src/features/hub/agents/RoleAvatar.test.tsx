import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

// `ModelSelectorLogo` is a Rive/WebGL surface jsdom can't render — stub it with an identifiable marker.
// (RoleAvatar no longer uses `Persona`; the fallback is a plain lucide `Bot` svg.)
vi.mock("@brand/ai", () => ({
  ModelSelectorLogo: (props: { provider?: string }) => (
    <div data-testid="model-logo" data-provider={props.provider} />
  ),
}));

import { RoleAvatar } from "./RoleAvatar";

describe("RoleAvatar resolution", () => {
  test("an uploaded image (data: URI) renders as a plain contained <img>, sized (whole image, no crop)", () => {
    const src = "data:image/png;base64,AAAA";
    const { container, queryByTestId } = render(<RoleAvatar id="a" icon={src} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", src);
    // "contain" (not cover) so a logo is never cropped; inscribed at 70% so its corners clear the circle.
    expect(img).toHaveClass("object-contain");
    expect(img).toHaveClass("size-[70%]");
    expect(queryByTestId("model-logo")).toBeNull();
  });

  test("a known lucide glyph renders an svg, not an image/model fallback", () => {
    const { container, queryByTestId } = render(
      <RoleAvatar id="a" icon="lucide:database" model="claude-sonnet-4-5" />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(queryByTestId("model-logo")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  test("a legacy bare name that matches a glyph still resolves to the icon", () => {
    const { container } = render(<RoleAvatar id="a" icon="search" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  test("no icon + a recognizable model → the model provider logo", () => {
    const { getByTestId } = render(<RoleAvatar id="a" model="gpt-4o" />);
    expect(getByTestId("model-logo")).toHaveAttribute("data-provider", "openai");
  });

  test("an unknown glyph name with no model falls through to the generic Bot glyph", () => {
    const { container, queryByTestId } = render(
      <RoleAvatar id="agent-42" icon="lucide:not-a-real-glyph-xyz" />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(queryByTestId("model-logo")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  test("no icon and no model → the generic Bot glyph (reliable, no WebGL)", () => {
    const { container, queryByTestId } = render(<RoleAvatar id="agent-1" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(queryByTestId("model-logo")).toBeNull();
  });
});
