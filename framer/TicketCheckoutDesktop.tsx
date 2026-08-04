import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

type TicketCheckoutProps = {
    apiBaseUrl: string
    ticketTypeId: string
    buttonLabel: string
    style?: React.CSSProperties
}

const newAttemptId = () => crypto.randomUUID()

export default function TicketCheckout({ apiBaseUrl, ticketTypeId, buttonLabel, style }: TicketCheckoutProps) {
    const [email, setEmail] = React.useState("")
    const [firstName, setFirstName] = React.useState("")
    const [lastName, setLastName] = React.useState("")
    const [quantity, setQuantity] = React.useState("1")
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState("")
    const isSubmittingRef = React.useRef(false)
    const checkoutAttemptIdRef = React.useRef(newAttemptId())

    async function startCheckout(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (isSubmittingRef.current) return

        isSubmittingRef.current = true
        setError("")
        setIsLoading(true)

        try {
            const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/checkout-sessions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    checkoutAttemptId: checkoutAttemptIdRef.current,
                    ticketTypeId,
                    quantity: Number(quantity),
                    customer: { email, firstName, lastName },
                }),
            })

            const data = await response.json()
            if (!response.ok || !data.checkoutUrl) throw new Error(data.error || "Unable to start checkout.")
            window.location.assign(data.checkoutUrl)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to start checkout. Please try again.")
            isSubmittingRef.current = false
            setIsLoading(false)
        }
    }

    const inputStyle: React.CSSProperties = {
        boxSizing: "border-box",
        width: "100%",
        height: "45px",
        padding: "12px 14px",
        border: "none",
        borderBottom: "1px solid #000000",
        borderRadius: 0,
        backgroundColor: "#fafaf5",
        color: "#000000",
        fontFamily: '"Times New Roman", Times, serif',
        fontSize: "14px",
    }

    return (
        <form onSubmit={startCheckout} style={{ ...style, width: "100%", display: "grid", gridTemplateColumns: "minmax(280px, 1fr) 145px auto", alignItems: "end", gap: 20, fontFamily: '"Times New Roman", Times, serif', fontSize: "14px" }}>
            <label style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span>Email:</span>
                <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={isLoading} style={inputStyle} />
            </label>

            <label style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span>First name:</span>
                <input required type="text" value={firstName} onChange={(event) => setFirstName(event.target.value)} disabled={isLoading} style={inputStyle} />
            </label>

            <label style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span>Last name:</span>
                <input required type="text" value={lastName} onChange={(event) => setLastName(event.target.value)} disabled={isLoading} style={inputStyle} />
            </label>

            <label style={{ display: "grid", gridTemplateColumns: "auto 64px", alignItems: "center", gap: 10 }}>
                <span>Quantity:</span>
                <select value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={isLoading} style={{ ...inputStyle, width: "64px", padding: "12px 6px" }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((number) => <option key={number} value={number}>{number}</option>)}
                </select>
            </label>

            <button type="submit" disabled={isLoading} style={{ border: 0, borderRadius: 0, padding: "12px 30px", height: "45px", background: "#151515", color: "#e9e9e9", cursor: isLoading ? "wait" : "pointer", fontFamily: '"Times New Roman", Times, serif', fontSize: "14px", fontWeight: 600 }}>
                {isLoading ? "Opening checkout…" : buttonLabel}
            </button>

            {error && <p role="alert" style={{ gridColumn: "1 / -1", margin: 0, color: "#b42318" }}>{error}</p>}
        </form>
    )
}

addPropertyControls(TicketCheckout, {
    apiBaseUrl: { type: ControlType.String, title: "API URL", defaultValue: "https://api.festival.cabinberlin.com" },
    ticketTypeId: { type: ControlType.String, title: "Ticket ID", defaultValue: "f10c33c5-6169-4397-b69e-a2713261db22" },
    buttonLabel: { type: ControlType.String, title: "Button", defaultValue: "Buy tickets" },
})
