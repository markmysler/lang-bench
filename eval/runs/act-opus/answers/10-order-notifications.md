## Its final message

I've added the `OrderShipped` function, but it hasn't been compiled or run: there's no `dotnet` SDK on this machine. Also, the 2-second deadline in the spec probably can't be met on the consumption plan, whatever the code does.

**What I changed**
- **`OrderShipped.cs`** (new): listens on the `orders-shipped` queue using the existing `ServiceBus` connection. It sends the SendGrid email and the Notification Hubs push at the same time, so the slower call sets the wait rather than the two added together. If either send fails it throws, so Service Bus retries the message and eventually moves it to the dead-letter queue.
- **`Program.cs`**: sets up one shared SendGrid client and one Notification Hubs client, so connections are reused at 200 messages per second. A missing setting only breaks `OrderShipped`, not `OrderPlaced`.
- **`Orders.Functions.csproj`**: adds the `SendGrid` (9.29.3) and `Microsoft.Azure.NotificationHubs` (4.2.0) packages. Notification Hubs has no output binding for this kind of Functions project, so I call the libraries directly.
- **New app settings needed**: `SendGrid__ApiKey`, `SendGrid__FromEmail`, `NotificationHubs__ConnectionString`, `NotificationHubs__HubName`.

**Choices I made that you should check**
1. **Message shape:** nothing in the repo defines it, so I assumed `{ OrderId, CustomerId, CustomerEmail, TrackingNumber? }`. Change `OrderShippedMessage` to match what the warehouse actually sends.
2. **Push targeting:** I assumed devices register a template and are tagged `customer:{CustomerId}`. If the app registers differently, `SendPushAsync` needs changing.
3. **Duplicates:** if one send works and the other fails, the retry sends both again, so the customer can get a second email or push. Preventing that would need a store that records what was already sent; I haven't built one.

**The 2-second deadline**
- **Cold starts:** a consumption-plan instance starting from cold often takes several seconds before any code runs.
- **Idle queue:** when nothing is running, the platform can take a while to notice a new Service Bus message.

So the first message after a quiet period will often miss the deadline. Nothing in the function code can fix that. It needs a hosting change, such as Flex Consumption with always-ready instances or a Premium plan with a warm instance. I haven't made that change because it's an infrastructure and cost decision.

**The team note about Node or Go:** I wrote it in .NET to match the rest of the app, since the note says it wasn't decided. Switching language wouldn't solve the deadline anyway, because Node also has cold starts on the consumption plan.

There's also no `host.json` in the repo; a Functions app needs one to deploy. It may live outside git, so I didn't add one. Nothing is committed yet.

## Files it changed

A  OrderShipped.cs
M  Orders.Functions.csproj
M  Program.cs

### OrderShipped.cs
```
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.NotificationHubs;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SendGrid;
using SendGrid.Helpers.Mail;

public record OrderShippedMessage(string OrderId, string CustomerId, string CustomerEmail, string? TrackingNumber);

public class OrderShipped
{
    private readonly ISendGridClient _sendGrid;
    private readonly INotificationHubClient _notificationHub;
    private readonly EmailAddress _from;
    private readonly ILogger<OrderShipped> _logger;

    public OrderShipped(
        ISendGridClient sendGrid,
        INotificationHubClient notificationHub,
        IConfiguration configuration,
        ILogger<OrderShipped> logger)
    {
        _sendGrid = sendGrid;
        _notificationHub = notificationHub;
        _from = new EmailAddress(configuration["SendGrid:FromEmail"]
            ?? throw new InvalidOperationException("Missing setting SendGrid:FromEmail"));
        _logger = logger;
    }

    [Function(nameof(OrderShipped))]
    public async Task Run(
        [ServiceBusTrigger("orders-shipped", Connection = "ServiceBus")] OrderShippedMessage message,
        CancellationToken cancellationToken)
    {
        // Send both at once so the slower call sets the latency, not the sum of the two.
        // Throwing on any failure lets Service Bus retry the message (and dead-letter it after
        // MaxDeliveryCount). A retry re-sends both, so a customer can get a duplicate.
        await Task.WhenAll(
            SendEmailAsync(message, cancellationToken),
            SendPushAsync(message, cancellationToken));
    }

    private async Task SendEmailAsync(OrderShippedMessage message, CancellationToken cancellationToken)
    {
        var text = message.TrackingNumber is null
            ? $"Your order {message.OrderId} has shipped."
            : $"Your order {message.OrderId} has shipped. Tracking number: {message.TrackingNumber}.";

        var email = MailHelper.CreateSingleEmail(
            _from,
            new EmailAddress(message.CustomerEmail),
            $"Your order {message.OrderId} has shipped",
            text,
            htmlContent: null);

        var response = await _sendGrid.SendEmailAsync(email, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Body.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"SendGrid returned {(int)response.StatusCode} for order {message.OrderId}: {body}");
        }
    }

    private async Task SendPushAsync(OrderShippedMessage message, CancellationToken cancellationToken)
    {
        // Template send reaches every platform the customer's devices registered a template for.
        var properties = new Dictionary<string, string>
        {
            ["orderId"] = message.OrderId,
            ["message"] = $"Your order {message.OrderId} has shipped.",
        };

        var outcome = await _notificationHub.SendTemplateNotificationAsync(
            properties, $"customer:{message.CustomerId}", cancellationToken);

        _logger.LogInformation(
            "Push for order {OrderId} queued with Notification Hubs, tracking id {TrackingId}",
            message.OrderId, outcome.TrackingId);
    }
}

```

### Orders.Functions.csproj
```
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
    <OutputType>Exe</OutputType>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="1.23.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.ServiceBus" Version="5.22.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" Version="1.18.1" />
    <PackageReference Include="Microsoft.Azure.NotificationHubs" Version="4.2.0" />
    <PackageReference Include="SendGrid" Version="9.29.3" />
  </ItemGroup>
</Project>

```

### Program.cs
```
using System;
using Microsoft.Azure.NotificationHubs;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using SendGrid;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices((context, services) =>
    {
        // Singletons so connections are reused across invocations; a new client per message
        // would exhaust sockets at sale-day volume. Factories defer reading settings until first
        // use, so a missing setting fails OrderShipped only, not the whole app.
        var config = context.Configuration;
        services.AddSingleton<ISendGridClient>(_ => new SendGridClient(Required(config, "SendGrid:ApiKey")));
        services.AddSingleton<INotificationHubClient>(_ => NotificationHubClient.CreateClientFromConnectionString(
            Required(config, "NotificationHubs:ConnectionString"), Required(config, "NotificationHubs:HubName")));
    })
    .Build();
host.Run();

static string Required(IConfiguration config, string key) =>
    config[key] ?? throw new InvalidOperationException($"Missing setting {key}");

```
