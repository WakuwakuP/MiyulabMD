import type { Preview } from "@storybook/react-vite";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { ThemeProvider } from "../src/hooks/use-theme.ts";
import "../src/styles/index.css";

const preview: Preview = {
  decorators: [
    (Story, { globals }) => {
      const scheme = globals.colorScheme;
      if (scheme === "black") {
        document.documentElement.dataset.theme = "black";
        document.documentElement.style.colorScheme = "dark";
      } else {
        delete document.documentElement.dataset.theme;
        document.documentElement.style.colorScheme =
          scheme === "dark" ? "dark" : "light";
      }

      return createElement(
        ThemeProvider,
        null,
        createElement(MemoryRouter, null, createElement(Story)),
      );
    },
  ],
  globalTypes: {
    colorScheme: {
      description: "Document color scheme (Canvas / CanvasText tokens)",
      toolbar: {
        dynamicTitle: true,
        icon: "circlehollow",
        items: [
          { icon: "sun", title: "Light", value: "light" },
          { icon: "moon", title: "Dark", value: "dark" },
          { icon: "circle", title: "Black", value: "black" },
        ],
        title: "Color scheme",
      },
    },
  },
  initialGlobals: {
    colorScheme: "light",
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
