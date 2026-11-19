// Security requirement: gracefully handle a missing Google photo or name.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import Avatar from "@/components/Avatar";
import DashboardNav from "@/components/DashboardNav";

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));
vi.mock("@/lib/auth-actions", () => ({ signOutAction: vi.fn() }));

afterEach(cleanup);

describe("Avatar", () => {
  it("shows the Google photo when there is one", () => {
    render(<Avatar src="https://lh3.googleusercontent.com/a/photo" name="Ada Lovelace" email="ada@example.com" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toContain("googleusercontent.com");
    expect(img.getAttribute("alt")).toBe("Ada Lovelace");
  });

  it("shows initials when there is no photo", () => {
    render(<Avatar src={null} name="Ada Lovelace" email="ada@example.com" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByLabelText("Ada Lovelace avatar").textContent).toBe("AL");
  });

  it("falls back to initials when the photo fails to load (e.g. an expired Google URL)", () => {
    render(<Avatar src="https://lh3.googleusercontent.com/a/expired" name="Ada Lovelace" email="ada@example.com" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByLabelText("Ada Lovelace avatar").textContent).toBe("AL");
  });

  it("uses the first two letters of a single-word name", () => {
    render(<Avatar src={null} name="Cher" email="cher@example.com" />);
    expect(screen.getByLabelText("Cher avatar").textContent).toBe("CH");
  });

  it("uses the email prefix when there is no name and no photo", () => {
    render(<Avatar src={null} name={null} email="foo.bar@example.com" />);
    expect(screen.getByLabelText("foo.bar@example.com avatar").textContent).toBe("FO");
  });

  it("never renders an empty avatar, even for an email prefix with no letters", () => {
    render(<Avatar src={null} name={null} email="12345@example.com" />);
    expect(screen.getByLabelText("12345@example.com avatar").textContent).toBe("?");
  });
});

describe("DashboardNav with missing Google data", () => {
  it("shows the email prefix as the name when Google gave no name, plus the email", () => {
    render(<DashboardNav user={{ name: null, email: "foo.bar@example.com", image: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open user menu" }));

    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("foo.bar");
    expect(menu.textContent).toContain("foo.bar@example.com");
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeTruthy();
  });

  it("shows the Google name when present", () => {
    render(<DashboardNav user={{ name: "Ada Lovelace", email: "ada@example.com", image: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open user menu" }));
    expect(screen.getByRole("menu").textContent).toContain("Ada Lovelace");
  });
});
