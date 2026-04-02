import { Button } from './Button'
import { useToast } from './Toast'

interface Props { text: string; label?: string }

export function CopyButton({ text, label = 'Copia' }: Props) {
  const { show } = useToast()
  return (
    <Button
      variant="secondary"
      size="sm"
      style={{ opacity: 0.65 }}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => show('✓ Copiato'))
      }}
    >
      {label}
    </Button>
  )
}
