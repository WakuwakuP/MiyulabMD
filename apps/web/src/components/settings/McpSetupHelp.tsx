import { useEffect, useRef } from "react";
import { mcpAuthorizationHeader, mcpEndpointUrl } from "../../lib/mcp-setup.ts";
import { Button } from "../ui/Button.tsx";
import { Field, Row } from "../ui/Field.tsx";
import { Input } from "../ui/Input.tsx";
import { MutedText } from "../ui/Text.tsx";
import { CopyValueButton } from "./CopyValueButton.tsx";
import { McpClientGuide } from "./McpClientGuide.tsx";

type Props = {
  origin: string;
  token: string;
  tokenName: string;
  onClose: () => void;
};

export function McpSetupHelp({ origin, token, tokenName, onClose }: Props) {
  const endpoint = mcpEndpointUrl(origin);
  const authorization = mcpAuthorizationHeader(token);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  return (
    <div
      ref={rootRef}
      className="my-4 rounded-md border border-border bg-surface px-4 py-3"
      role="status"
    >
      <p>
        <strong>{tokenName}</strong>{" "}
        を発行しました。トークンはこの画面で一度だけ表示されます。
      </p>
      <MutedText className="mt-2">
        使うクライアントを選ぶと、貼り付け用の設定が出ます。
      </MutedText>

      <div className="mt-4 grid gap-3">
        <Field label="トークン">
          <Row>
            <Input
              className="min-w-0 flex-1 font-mono"
              readOnly
              value={token}
            />
            <CopyValueButton value={token} />
          </Row>
        </Field>
        <Field label="エンドポイント">
          <Row>
            <Input
              className="min-w-0 flex-1 font-mono"
              readOnly
              value={endpoint}
            />
            <CopyValueButton value={endpoint} />
          </Row>
        </Field>
        <Field label="Authorization">
          <Row>
            <Input
              className="min-w-0 flex-1 font-mono"
              readOnly
              value={authorization}
            />
            <CopyValueButton value={authorization} />
          </Row>
        </Field>
      </div>

      <McpClientGuide origin={origin} token={token} />

      <Row className="mt-3">
        <Button variant="outline" onClick={onClose}>
          閉じる
        </Button>
      </Row>
    </div>
  );
}
