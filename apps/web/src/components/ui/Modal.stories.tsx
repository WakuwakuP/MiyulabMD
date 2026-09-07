import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./Button.tsx";
import { Modal, ModalFooter, ModalHeader } from "./Modal.tsx";

const meta = {
  tags: ["autodocs"],
  title: "UI/Modal",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: function Render() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button onClick={() => setOpen(true)}>モーダルを開く</Button>
        {open && (
          <Modal labelledBy="demo-modal-title" onClose={() => setOpen(false)}>
            <ModalHeader
              id="demo-modal-title"
              onClose={() => setOpen(false)}
              title="ノートを削除"
            />
            <p className="m-0 text-muted">この操作は取り消せません。</p>
            <ModalFooter>
              <Button onClick={() => setOpen(false)}>キャンセル</Button>
              <Button onClick={() => setOpen(false)} variant="danger">
                削除
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </>
    );
  },
};
