import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

type TicketCheckoutProps = {
    apiBaseUrl: string
    ticketTypeId: string
    buttonLabel: string
    style?: React.CSSProperties
}

const newAttemptId = () => crypto.randomUUID()

export default function TicketCheckout({
    apiBaseUrl,
    ticketTypeId,
    buttonLabel,
    style,
}: TicketCheckoutProps) {
    const [email, setEmail] = React.useState("")
    const [quantity, setQuantity] = React.useState("1")
    const [attendees, setAttendees] = React.useState([
        { firstName: "", lastName: "" },
    ])
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState("")
    const isSubmittingRef = React.useRef(false)
    const checkoutAttemptIdRef = React.useRef(newAttemptId())

    function updateQuantity(nextQuantity: string) {
        const count = Number(nextQuantity)
        setQuantity(nextQuantity)
        setAttendees((current) =>
            Array.from({ length: count }, (_, index) =>
                current[index] ?? { firstName: "", lastName: "" }
            )
        )
    }

    function updateAttendee(
        index: number,
        field: "firstName" | "lastName",
        value: string
    ) {
        setAttendees((current) =>
            current.map((attendee, attendeeIndex) =>
                attendeeIndex === index
                    ? { ...attendee, [field]: value }
                    : attendee
            )
        )
    }

    async function startCheckout(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (isSubmittingRef.current) return

        isSubmittingRef.current = true
        setError("")
        setIsLoading(true)

        try {
            const response = await fetch(
                `${apiBaseUrl.replace(/\/$/, "")}/api/checkout-sessions`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        checkoutAttemptId: checkoutAttemptIdRef.current,
                        ticketTypeId,
                        quantity: Number(quantity),
                        customer: { email },
                        attendees,
                    }),
                }
            )

            const data = await response.json()
            if (!response.ok || !data.checkoutUrl) {
                throw new Error(data.error || "Unable to start checkout.")
            }

            window.location.assign(data.checkoutUrl)
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to start checkout. Please try again."
            )
            isSubmittingRef.current = false
            setIsLoading(false)
        }
    }

    return (
        <form
            onSubmit={startCheckout}
            style={{
                ...style,
                width: "100%",
                display: "grid",
                gap: 12,
                fontFamily: "inherit",
            }}
        >
            <label style={{ display: "grid", gap: 6 }}>
                <span>Email address</span>
                <input
                    required
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    disabled={isLoading}
                    style={{
                        boxSizing: "border-box",
                        width: "100%",
                        padding: "12px 14px",
                        border: "1px solid #b7b7b7",
                        borderRadius: 8,
                        font: "inherit",
                    }}
                />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
                <span>Quantity</span>
                <select
                    value={quantity}
                    onChange={(event) => updateQuantity(event.target.value)}
                    disabled={isLoading}
                    style={{
                        boxSizing: "border-box",
                        width: "100%",
                        padding: "12px 14px",
                        border: "1px solid #b7b7b7",
                        borderRadius: 8,
                        font: "inherit",
                    }}
                >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((number) => (
                        <option key={number} value={number}>
                            {number}
                        </option>
                    ))}
                </select>
            </label>

            <fieldset
                style={{
                    border: 0,
                    padding: 0,
                    margin: 0,
                    display: "grid",
                    gap: 12,
                }}
            >
                <legend style={{ marginBottom: 6, fontWeight: 600 }}>
                    Ticket holders
                </legend>

                {attendees.map((attendee, index) => (
                    <div
                        key={index}
                        style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                            gap: 10,
                        }}
                    >
                        <input
                            required
                            type="text"
                            value={attendee.firstName}
                            onChange={(event) =>
                                updateAttendee(index, "firstName", event.target.value)
                            }
                            placeholder={`Ticket ${index + 1} first name`}
                            disabled={isLoading}
                            aria-label={`Ticket ${index + 1} holder first name`}
                            style={{
                                boxSizing: "border-box",
                                width: "100%",
                                padding: "12px 14px",
                                border: "1px solid #b7b7b7",
                                borderRadius: 8,
                                font: "inherit",
                            }}
                        />
                        <input
                            required
                            type="text"
                            value={attendee.lastName}
                            onChange={(event) =>
                                updateAttendee(index, "lastName", event.target.value)
                            }
                            placeholder={`Ticket ${index + 1} last name`}
                            disabled={isLoading}
                            aria-label={`Ticket ${index + 1} holder last name`}
                            style={{
                                boxSizing: "border-box",
                                width: "100%",
                                padding: "12px 14px",
                                border: "1px solid #b7b7b7",
                                borderRadius: 8,
                                font: "inherit",
                            }}
                        />
                    </div>
                ))}
            </fieldset>

            {error && (
                <p role="alert" style={{ margin: 0, color: "#b42318" }}>
                    {error}
                </p>
            )}

            <button
                type="submit"
                disabled={isLoading}
                style={{
                    border: 0,
                    borderRadius: 8,
                    padding: "14px 18px",
                    background: "#151515",
                    color: "#ffffff",
                    cursor: isLoading ? "wait" : "pointer",
                    font: "inherit",
                    fontWeight: 600,
                }}
            >
                {isLoading ? "Opening checkout…" : buttonLabel}
            </button>
        </form>
    )
}

addPropertyControls(TicketCheckout, {
    apiBaseUrl: {
        type: ControlType.String,
        title: "API URL",
        defaultValue: "https://api.festival.cabinberlin.com",
    },
    ticketTypeId: {
        type: ControlType.String,
        title: "Ticket ID",
        defaultValue: "f10c33c5-6169-4397-b69e-a2713261db22",
    },
    buttonLabel: {
        type: ControlType.String,
        title: "Button",
        defaultValue: "Buy tickets",
    },
})
