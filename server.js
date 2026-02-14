const express = require('express');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- 1. CONFIGURAÇÃO DO FIREBASE ADMIN ---
// Você precisa baixar o arquivo .json das "Contas de Serviço" no Console do Firebase
const serviceAccount = require("./sua-chave-firebase.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://estacione-6cfbf-default-rtdb.firebaseio.com"
});
const db = admin.database();

// --- 2. CONFIGURAÇÃO DO MERCADO PAGO ---
// Use o seu ACCESS TOKEN de produção que você pegou no painel
const mpClient = new MercadoPagoConfig({ accessToken: 'SEU_ACCESS_TOKEN_AQUI' });
const payment = new Payment(mpClient);

// --- 3. ROTA PARA GERAR O PIX ---
app.post('/gerar-pix', async (req, res) => {
    try {
        const { valor, email } = req.body;

        const body = {
            transaction_amount: valor,
            description: 'Recarga Estacione Colombo',
            payment_method_id: 'pix',
            payer: { email: email },
            // Essa URL deve ser o link que o Render vai te dar + /webhook
            notification_url: "https://seu-projeto-no-render.onrender.com/webhook"
        };

        const response = await payment.create({ body });
        res.json({ qr_code: response.point_of_interaction.transaction_data.qr_code });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao gerar PIX" });
    }
});

// --- 4. WEBHOOK (O INTERFONE QUE LIBERA O SALDO) ---
app.post('/webhook', async (req, res) => {
    const { action, data } = req.body;

    if (action === "payment.created" || req.query.topic === "payment") {
        const paymentId = data?.id || req.query.id;

        try {
            const pagamento = await payment.get({ id: paymentId });

            if (pagamento.status === 'approved') {
                const valorPago = pagamento.transaction_amount;
                const emailCliente = pagamento.payer.email;

                // Busca o usuário no Firebase pelo e-mail
                const usersRef = db.ref('usuarios');
                const snapshot = await usersRef.orderByChild('email').equalTo(emailCliente).once('value');

                if (snapshot.exists()) {
                    const userId = Object.keys(snapshot.val())[0];
                    const userLogado = snapshot.val()[userId];
                    const novoSaldo = (userLogado.saldo || 0) + valorPago;

                    await usersRef.child(userId).update({ saldo: novoSaldo });
                    console.log(`✅ Saldo de R$ ${valorPago} creditado para ${emailCliente}`);
                }
            }
        } catch (e) {
            console.error("Erro no Webhook:", e);
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));