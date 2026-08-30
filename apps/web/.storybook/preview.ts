import type { Preview } from "@storybook/react-vite";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { ThemeProvider } from "../src/hooks/use-theme.ts";
import "../src/styles/index.css";

const preview: Preview = {
  globalTypes: {
    colorScheme: {
      description: "Document color scheme (Canvas / CanvasText tokens)",
      toolbar: {
        title: "Color scheme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    colorScheme: "light",
  },
  decorators: [
    (Story, { globals }) => {
      document.documentElement.style.colorScheme =
        globals.colorScheme === "dark" ? "dark" : "light";

      return createElement(
        ThemeProvider,
        null,
        createElement(MemoryRouter, null, createElement(Story)),
      );
    },
  ],
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
